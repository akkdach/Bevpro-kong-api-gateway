#!/bin/sh
# =====================================================
# add-sap-egress-test-route.sh — ทางเทสขาออกไป SAP PI ที่ "ไม่ผูกกับ IP"
#
#   /sap-pi-test/<path>  ->  https://qbx.thainamthip.co.th:8100/<path>   (upstream เดียวกับ /sap-pi)
#   กั้นด้วย key-auth (API key ใน header `apikey`) แทน ip-restriction
#
# ทำไม: route /sap-pi ใช้ ip-restriction ซึ่งถูกต้องสำหรับ D365 (20.44.247.33) และ fo-gateway
#   แต่คนทดสอบนั่งอยู่หลังเน็ตออฟฟิศที่เป็น dynamic IP เปลี่ยนเกือบทุกวัน
#   (171.103.89.247 → 87.124.104.34 → 124.120.31.223 → 124.122.190.153 ภายใน 3 วัน)
#   ทำให้ต้องตามแก้ allow list ไม่จบ — route นี้ให้คนทดสอบถือ key ติดตัวแทน ใช้ได้จากทุกเน็ต
#   เพิกถอนได้ทันทีด้วยการลบ key และ log แยกเป็น consumer `sap-tester` ชัดเจน
#
# ทำไม key ต้องอยู่ใน header เท่านั้น (key_in_query=false):
#   log-receiver เก็บ request.uri ซึ่งรวม query string → ถ้าให้ส่ง ?apikey=... key จะหลุดลง kong_api_logs
#   hide_credentials=true → Kong ถอด header apikey ออกก่อนส่งต่อ SAP จะไม่เห็น key ของเรา
#
# Authorization header ยังว่างให้ผู้เรียกใส่ Basic auth ของ SVC_NAV_01 ได้ตามปกติ (key-auth ใช้คนละ header)
#
# ผลที่คาดหวังเมื่อยิงโดยไม่ส่ง Basic auth ของ SAP:
#   401 + body เป็น HTML "SAP NetWeaver ... Error Report"   = ผ่าน Kong แล้ว ถึง SAP (เป้าหมายของสคริปต์นี้)
#   401 + body เป็น JSON {"message":"No API key found..."}  = ลืมส่ง header apikey / key ผิด (Kong ตอบ)
#   504                                                    = SAP ไม่ตอบ / whitelist 20.6.32.81 หลุด
#
# ⚠️ API key = รหัสผ่านตัวหนึ่ง: ส่งให้คนที่ต้องใช้ทางช่องทางปลอดภัย ห้ามวางในแชทกลุ่ม/ตั๋ว/README
#    หมุน key ใหม่: curl -X DELETE $ADMIN/consumers/sap-tester/key-auth/<id> แล้วรันสคริปต์นี้ซ้ำ
#
# idempotent: รันซ้ำได้ — ถ้ามี key อยู่แล้วจะใช้ตัวเดิม ไม่สร้างเพิ่ม
# ใช้: sh add-sap-egress-test-route.sh      (บน VM หลัง scp ขึ้นไป · ต้องมี service sap-pi อยู่ก่อน)
# rollback:
#   curl -X DELETE "$ADMIN/routes/sap-pi-test"
#   curl -X DELETE "$ADMIN/consumers/sap-tester"
#
# ⛔ ยกเลิกแล้ว 2026-10-07: ผู้ดูแลตัดสินใจใช้ ip-restriction อย่างเดียว ไม่ใช้ API key
#    ลบ route sap-pi-test + consumer sap-tester ออกจาก Kong แล้ว และ service sap-pi เปลี่ยนชื่อเป็น sap-pi-uat
#    เก็บไฟล์ไว้เป็นประวัติ — ห้ามรันใหม่ (ทางเทสปัจจุบัน = /sap-pi-uat)
# =====================================================
echo "add-sap-egress-test-route.sh ถูกยกเลิกแล้ว (2026-10-07) — ใช้ /sap-pi-uat แทน"; exit 1

ADMIN="${KONG_ADMIN:-http://localhost:8001}"
PUBLIC_HOST="${KONG_PUBLIC_HOST:-bevprogateway.southeastasia.cloudapp.azure.com}"

# plugin id ของชื่อที่กำหนดบน route — ว่าง = ยังไม่มี
plugin_id() { curl -s "$ADMIN/routes/$1/plugins" | python3 -c "import json,sys;d=json.load(sys.stdin).get('data',[]);print(next((p['id'] for p in d if p['name']=='$2'),''))" 2>/dev/null; }

echo "=== 0 ตรวจว่า service sap-pi มีอยู่ ==="
code=$(curl -s -o /dev/null -w '%{http_code}' "$ADMIN/services/sap-pi")
if [ "$code" != "200" ]; then echo "  ไม่พบ service sap-pi (http $code) — รัน add-sap-egress-route.sh ก่อน"; exit 1; fi
echo "  ok"

echo "=== 1 route /sap-pi-test -> service sap-pi ==="
curl -s -o /dev/null -w "  PUT route sap-pi-test -> %{http_code}\n" -X PUT "$ADMIN/services/sap-pi/routes/sap-pi-test" \
  --data "paths[]=/sap-pi-test" \
  --data "strip_path=true" \
  --data "protocols[]=https" \
  --data "methods[]=POST" --data "methods[]=GET" --data "methods[]=HEAD" \
  --data "tags[]=sap-egress"

echo "=== 2 plugin key-auth (header apikey เท่านั้น · ถอดออกก่อนส่งต่อ) ==="
ID=$(plugin_id sap-pi-test key-auth)
if [ -n "$ID" ]; then
  curl -s -o /dev/null -w "  key-auth (อัปเดต) -> %{http_code}\n" -X PATCH "$ADMIN/plugins/$ID" \
    --data "config.key_names[]=apikey" \
    --data "config.key_in_header=true" --data "config.key_in_query=false" --data "config.key_in_body=false" \
    --data "config.hide_credentials=true"
else
  curl -s -o /dev/null -w "  key-auth (สร้าง) -> %{http_code}\n" -X POST "$ADMIN/routes/sap-pi-test/plugins" \
    --data "name=key-auth" \
    --data "config.key_names[]=apikey" \
    --data "config.key_in_header=true" --data "config.key_in_query=false" --data "config.key_in_body=false" \
    --data "config.hide_credentials=true"
fi

echo "=== 3 plugin request-transformer (X-App-Name ให้ dashboard แยกว่าเป็นการเทส) ==="
ID=$(plugin_id sap-pi-test request-transformer)
if [ -n "$ID" ]; then
  curl -s -o /dev/null -w "  request-transformer (อัปเดต) -> %{http_code}\n" -X PATCH "$ADMIN/plugins/$ID" \
    --data "config.add.headers[]=X-App-Name:sap-tester"
else
  curl -s -o /dev/null -w "  request-transformer (สร้าง) -> %{http_code}\n" -X POST "$ADMIN/routes/sap-pi-test/plugins" \
    --data "name=request-transformer" \
    --data "config.add.headers[]=X-App-Name:sap-tester"
fi

echo "=== 4 consumer sap-tester ==="
curl -s -o /dev/null -w "  PUT consumer sap-tester -> %{http_code}\n" -X PUT "$ADMIN/consumers/sap-tester" \
  --data "custom_id=sap-tester"

echo "=== 5 API key ==="
KEY=$(curl -s "$ADMIN/consumers/sap-tester/key-auth" | python3 -c "import json,sys;d=json.load(sys.stdin).get('data',[]);print(d[0]['key'] if d else '')" 2>/dev/null)
if [ -n "$KEY" ]; then
  echo "  มี key อยู่แล้ว ใช้ตัวเดิม"
else
  # ไม่ส่ง key= ให้ Kong สุ่มให้เอง (32 ตัวอักษร)
  KEY=$(curl -s -X POST "$ADMIN/consumers/sap-tester/key-auth" | python3 -c "import json,sys;print(json.load(sys.stdin)['key'])")
  echo "  สร้าง key ใหม่"
fi

sleep 6

# --- เทสจากบน VM: ไม่ส่ง Basic auth ของ SAP ต้องการแค่พิสูจน์ว่า "ผ่าน Kong แล้วถึง SAP" ---
QS="senderService=sys_TNTLFTDNAVService&interface=WorkOrderUpdate_Out&interfaceNamespace=http://pi.coca-cola.com.th/tntl_i_processworkorder/sendfromnav/"
URL="https://$PUBLIC_HOST/sap-pi-test/XISOAPAdapter/MessageServlet?$QS"
RESOLVE="--resolve $PUBLIC_HOST:443:127.0.0.1"
TMP=$(mktemp)

echo "=== tests ==="
printf 'ไม่ส่ง key          : '
code=$(curl -sk $RESOLVE -o "$TMP" -w '%{http_code}' --max-time 30 "$URL")
grep -q "No API key" "$TMP" && echo "$code (Kong ปฏิเสธ — ถูกต้อง)" || echo "$code (ผิดคาด: $(head -c 80 "$TMP"))"

printf 'ส่ง key ถูก          : '
code=$(curl -sk $RESOLVE -o "$TMP" -w '%{http_code}' --max-time 30 -H "apikey: $KEY" "$URL")
if grep -qi "NetWeaver\|Error Report" "$TMP"; then echo "$code จาก SAP เอง = ผ่าน Kong ถึง SAP แล้ว ✔"
elif grep -q "No API key\|Invalid authentication" "$TMP"; then echo "$code จาก Kong — key ไม่ผ่าน"
else echo "$code ($(head -c 80 "$TMP"))"; fi
rm -f "$TMP"

echo
echo "=== วิธีใช้จากเครื่องไหนก็ได้ (ไม่ต้องสน IP) ==="
echo "PowerShell:"
echo "  curl.exe -sk -o NUL -w \"%{http_code}\" -H \"apikey: $KEY\" \"$URL\""
echo "ต้องได้ 401 = ถึง SAP (SAP ขอ Basic auth ของ SVC_NAV_01)"
echo
echo "⚠️ key ข้างบนแสดงครั้งนี้ครั้งเดียว เก็บในที่ปลอดภัย ดูซ้ำได้ด้วย: curl -s $ADMIN/consumers/sap-tester/key-auth"
