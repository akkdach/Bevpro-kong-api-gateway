#!/bin/sh
# =====================================================
# add-response-body-capture.sh — เก็บ response body ของเส้น interface SAP ลง log (field response_body)
#
# ทำไมต้องมี: SIMS ตอบ HTTP 200 เสมอ แล้วบอกผลจริงใน <TYPE> (S = สำเร็จ / E = error) + <MESSAGE>
#   ดูแค่ status code แยกไม่ออกว่าใบงานเข้าจริงไหม (เจอจริง 2026-10-07: ส่งข้อความมั่วก็ได้ 200)
#   ฝั่ง SAP PI ก็ตอบ SOAP fault / หน้า HTML error ที่บอกสาเหตุไว้ใน body เหมือนกัน
#
# ขอบเขต: เฉพาะ route interface SAP ใน ROUTES (post-function ผูกระดับ route) — แอปมือถือและ route อื่นไม่ถูกแตะ
#   sims-uat-sap-service-orders          SAP -> SIMS
#   sap-pi-uat-soap / sap-pi-prod-soap   SIMS -> SAP แยก environment (QAS / PRD)
#   (sap-pi-soap /sap-pi ถูกลบ 2026-10-07)
#
# วิธีทำงาน:
#   access      : ลบ header Accept-Encoding ก่อนส่งต่อ ให้ปลายทางตอบแบบไม่บีบอัด (log อ่านออก)
#   body_filter : เก็บ "สำเนา" ของทุก chunk ใน kong.ctx.plugin โดยไม่แก้ ngx.arg
#                 = response ที่ส่งกลับให้ผู้เรียกไม่ถูกแก้/ไม่ถูก buffer
#                 (ไม่ใช้ kong.response.get_raw_body เพราะตัวนั้นเปลี่ยน chunk ระหว่างทาง)
#                 จบ response แล้ว set_serialize_value("response_body") -> http-log -> log-receiver
#   cap 64 KB · mask element/field ชื่อ password เหมือน request_body · ถ้ายังถูกบีบอัดเก็บแค่ "[compressed gzip]"
#   ครอบ pcall ทั้งก้อน: Lua พังตรงไหน response ยังผ่านปกติ
#
# ⚠️ response ของ SIMS ส่งใบงานทั้งใบกลับมา (มี PII ลูกค้า) -> ล้างที่ 30 วันโดย purge-log-bodies.sh
# ต้องมีคอลัมน์ kong_api_logs.response_body (init-db/001-create-logs-table.sql) และ log-receiver ที่รับ field นี้
#
# ⚠️ ห้ามย้ายโค้ดนี้ไปใส่ pre-function แบบ route — plugin ชื่อเดียวกันระดับ route จะทับตัว global
#    (pre-function global = jwt_sub + request_body ของทุก route) จึงใช้ post-function แยก
#
# idempotent: รันซ้ำได้ · ใช้: sh scripts/add-response-body-capture.sh
# rollback (ต่อ route):
#   curl -s "$ADMIN/routes/<route>/plugins" -> หา id ของ post-function -> curl -X DELETE "$ADMIN/plugins/<id>"
# =====================================================
ADMIN="${KONG_ADMIN:-http://localhost:8001}"
ROUTES="sims-uat-sap-service-orders sap-pi-uat-soap sap-pi-prod-soap"

# หมายเหตุ: ห้ามมี single quote ในโค้ด Lua (ครอบด้วย single quote ของ shell) — ใช้ \" แทน
# บรรทัดที่ 2: field auth_info = "ใครยิงมา" โดยไม่มีรหัส — Kong เซ็นเซอร์ Authorization ใน log เป็น REDACTED เสมอ
#   Basic -> "Basic user=<username> pass_len=<ความยาวรหัส> b64_len=<ความยาว base64>" · Bearer -> แค่ความยาว token
#   pass_len ใช้จับเคสรหัสถูกตัด (SAP PI ตัด base64 ทุก 76 ตัว 2026-10-14: TNT ได้ pass_len=40 แต่รหัสจริง 64)
#   ⛔ ห้ามใส่ตัวรหัสหรือค่า Authorization ดิบลง field นี้ · log-receiver เอาไปแสดงแทนค่า authorization ใน request_headers
ACCESS_LUA='pcall(function() kong.service.request.clear_header("Accept-Encoding") end)
pcall(function()
  local a = kong.request.get_header("Authorization")
  if not a then return end
  local scheme, cred = a:match("^%s*(%S+)%s+(%S+)")
  if not scheme then kong.log.set_serialize_value("auth_info", "unparsable (" .. #a .. " chars)") return end
  if scheme:lower() == "basic" then
    local dec = ngx.decode_base64(cred)
    local user, pass = (dec or ""):match("^([^:]*):(.*)$")
    if not user then kong.log.set_serialize_value("auth_info", "Basic (not user:pass) b64_len=" .. #cred) return end
    kong.log.set_serialize_value("auth_info", "Basic user=" .. user:sub(1, 64) .. " pass_len=" .. #pass .. " b64_len=" .. #cred)
  else
    kong.log.set_serialize_value("auth_info", scheme .. " (token_len=" .. #cred .. ")")
  end
end)'

BODY_LUA='pcall(function()
  local CAP = 65536
  local ctx = kong.ctx.plugin
  local chunk, eof = ngx.arg[1], ngx.arg[2]
  if chunk and chunk ~= "" and (ctx.rb_len or 0) <= CAP then
    ctx.rb = ctx.rb or {}
    ctx.rb[#ctx.rb + 1] = chunk
    ctx.rb_len = (ctx.rb_len or 0) + #chunk
  end
  if not eof or not ctx.rb then return end
  local body = table.concat(ctx.rb)
  ctx.rb = nil
  local enc = (kong.response.get_header("Content-Encoding") or ""):lower()
  if enc ~= "" and enc ~= "identity" then
    kong.log.set_serialize_value("response_body", "[compressed " .. enc .. "]")
    return
  end
  for _, k in ipairs({"password", "Password", "PASSWORD", "pwd", "passwd"}) do
    body = body:gsub("(<[%w_:]*" .. k .. "[^>]*>)[^<]*", "%1***")
    body = body:gsub("(\"" .. k .. "\"%s*:%s*\")[^\"]*", "%1***")
  end
  if #body > CAP then body = body:sub(1, CAP) .. "...[truncated]" end
  kong.log.set_serialize_value("response_body", body)
end)'

for R in $ROUTES; do
  echo "=== route $R ==="
  EXISTING=$(curl -s "$ADMIN/routes/$R/plugins" | python3 -c "import json,sys;d=json.load(sys.stdin).get('data',[]);print(next((p['id'] for p in d if p['name']=='post-function'),''))" 2>/dev/null)
  if [ -n "$EXISTING" ]; then
    curl -s -o /dev/null -w "  post-function (อัปเดต) -> %{http_code}\n" -X PATCH "$ADMIN/plugins/$EXISTING" \
      --data-urlencode "config.access[1]=$ACCESS_LUA" \
      --data-urlencode "config.body_filter[1]=$BODY_LUA"
  else
    curl -s -o /dev/null -w "  post-function (สร้าง) -> %{http_code}\n" -X POST "$ADMIN/routes/$R/plugins" \
      --data "name=post-function" \
      --data "tags[]=response-body-capture" \
      --data-urlencode "config.access[1]=$ACCESS_LUA" \
      --data-urlencode "config.body_filter[1]=$BODY_LUA"
  fi
done

echo ""
echo "=== ตรวจ ==="
for R in $ROUTES; do
  curl -s "$ADMIN/routes/$R/plugins" | python3 -c "
import json, sys
for p in json.load(sys.stdin)['data']:
    if p['name'] == 'post-function':
        print('  $R post-function enabled=%s phases=%s' % (p['enabled'], [k for k, v in p['config'].items() if v]))
"
done
