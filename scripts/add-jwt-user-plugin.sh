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
# =====================================================
ADMIN="${KONG_ADMIN:-http://localhost:8001}"

LUA='local auth = kong.request.get_header("authorization")
if not auth then return end
local token = auth:match("[Bb]earer%s+(.+)")
if not token then return end
local payload_b64 = token:match("^[^%.]+%.([^%.]+)%.")
if not payload_b64 then return end
local b64 = payload_b64:gsub("%-", "+"):gsub("_", "/")
local pad = #b64 % 4
if pad > 0 then b64 = b64 .. string.rep("=", 4 - pad) end
local ok, decoded = pcall(ngx.decode_base64, b64)
if not ok or not decoded then return end
local sub = decoded:match([["sub"%s*:%s*"([^"]+)"]])
if sub then
  kong.log.set_serialize_value("jwt_sub", sub)
end'

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
