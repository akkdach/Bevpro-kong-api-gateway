#!/bin/sh
# =====================================================
# add-jwt-user-plugin.sh — ดึงชื่อผู้ใช้จาก JWT ใส่เข้า log
#
# ปัญหา: Kong 3.x เซ็นเซอร์ header authorization เป็น "REDACTED" ก่อนส่งเข้า log
#        (มาตรการความปลอดภัยของ Kong เอง ปิดไม่ได้) -> log-receiver ถอด JWT เองไม่ได้
#
# วิธีแก้: ใช้ pre-function (Lua) อ่าน token ตั้งแต่ตอน request เข้ามา
#         ถอดเอาเฉพาะ claim sub แล้วยัดเข้า log ผ่าน kong.log.set_serialize_value
#
# ⚠️ ดึงเฉพาะ sub เท่านั้น — BEVProAPI ใส่รหัสผ่านผู้ใช้ไว้ใน claim email
#    (AuthenController.cs: new Claim(JwtRegisteredClaimNames.Email, password))
#    ห้ามเก็บ payload ทั้งก้อนเด็ดขาด
#
# ไม่ตรวจลายเซ็น — jwt plugin ตรวจให้แล้ว ตัวนี้แค่อ่านชื่อไปบันทึก
#
# ส่วนที่ 2 (เพิ่ม 2026-08-21): เก็บ request body ลง log (field request_body)
#   - http-log ของ Kong ไม่ส่ง body มาเอง ต้องอ่านที่ access phase แล้ว set_serialize_value
#   - เก็บเฉพาะ POST/PUT/PATCH ที่ Content-Type เป็น JSON / form / text
#   - Kong proxy ตั้ง client_body_buffer_size 8k -> body ใหญ่กว่านั้น get_raw_body() คืน nil
#     = upload รูป (median 778 KB) ไม่ถูกเก็บโดยอัตโนมัติ (ไม่งั้น disk โต 60 GB/สัปดาห์)
#   - ตัดที่ 4 KB
#   - ⚠️ เส้น login ทุกแบบ (path มี /authen/ /auth/ หรือ login เช่น /Authen/token, /auth/azure-login)
#     body = username+password หรือ token ของ Azure AD -> เก็บเป็น "[REDACTED login]" ทั้งก้อน
#   - field ชื่อ password / pwd / passwd ทุก endpoint -> mask เป็น ***
#   - ครอบ pcall ทั้งส่วน: Lua พังตรงไหน request ยังผ่านปกติ (plugin นี้เป็น global)
#   - ล้าง body ที่เก่ากว่า 30 วันด้วย scripts/purge-log-bodies.sh (cron รายวัน)
# =====================================================
ADMIN="${KONG_ADMIN:-http://localhost:8001}"

# หมายเหตุ: ห้ามมี single quote (ข้างในครอบด้วย single quote ของ shell) — ใช้ \" แทน
LUA='local auth = kong.request.get_header("authorization")
if auth then
  local token = auth:match("[Bb]earer%s+(.+)")
  if token then
    local payload_b64 = token:match("^[^%.]+%.([^%.]+)%.")
    if payload_b64 then
      local b64 = payload_b64:gsub("%-", "+"):gsub("_", "/")
      local pad = #b64 % 4
      if pad > 0 then b64 = b64 .. string.rep("=", 4 - pad) end
      local ok, decoded = pcall(ngx.decode_base64, b64)
      if ok and decoded then
        local sub = decoded:match([["sub"%s*:%s*"([^"]+)"]])
        if sub then kong.log.set_serialize_value("jwt_sub", sub) end
      end
    end
  end
end

-- ส่วนที่ 2: request body (redact login, mask password, cap 4 KB)
pcall(function()
  local m = kong.request.get_method()
  if m ~= "POST" and m ~= "PUT" and m ~= "PATCH" then return end
  local ct = (kong.request.get_header("content-type") or ""):lower()
  if not (ct:find("json", 1, true) or ct:find("x-www-form-urlencoded", 1, true) or ct:find("text/", 1, true)) then
    return
  end
  local p = kong.request.get_path():lower()
  if p:find("/authen/", 1, true) or p:find("/auth/", 1, true) or p:find("login", 1, true) then
    kong.log.set_serialize_value("request_body", "[REDACTED login]")
    return
  end
  local body = kong.request.get_raw_body()
  if not body or body == "" then return end
  for _, k in ipairs({"password", "Password", "PASSWORD", "pwd", "Pwd", "passwd", "Passwd"}) do
    body = body:gsub("(\"" .. k .. "\"%s*:%s*\")[^\"]*", "%1***")
    body = body:gsub("(" .. k .. "=)[^&]*", "%1***")
  end
  if #body > 4096 then body = body:sub(1, 4096) .. "...[truncated]" end
  kong.log.set_serialize_value("request_body", body)
end)'

echo "=== ติดตั้ง pre-function (global) ==="
EXISTING=$(curl -s "$ADMIN/plugins?size=300" | python3 -c "
import sys, json
for p in json.load(sys.stdin)['data']:
    if p['name'] == 'pre-function' and not p.get('route') and not p.get('service'):
        print(p['id']); break
")

if [ -n "$EXISTING" ]; then
  echo "  มีอยู่แล้ว (id $EXISTING) -> อัปเดตโค้ด"
  curl -s -o /dev/null -w "  PATCH -> %{http_code}\n" -X PATCH "$ADMIN/plugins/$EXISTING" \
    --data-urlencode "config.access[1]=$LUA"
else
  curl -s -o /dev/null -w "  POST -> %{http_code}\n" -X POST "$ADMIN/plugins" \
    --data "name=pre-function" \
    --data-urlencode "config.access[1]=$LUA"
fi

echo ""
echo "=== ตรวจว่าติดตั้งแล้ว ==="
curl -s "$ADMIN/plugins?size=300" | python3 -c "
import sys, json
for p in json.load(sys.stdin)['data']:
    if p['name'] == 'pre-function':
        scope = 'GLOBAL' if not p.get('route') and not p.get('service') else 'scoped'
        print(f\"  pre-function {scope} enabled={p['enabled']} phases={list(p['config'].keys())}\")
"
