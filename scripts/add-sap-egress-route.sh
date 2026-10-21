#!/bin/sh
# =====================================================
# add-sap-egress-route.sh — ขาออกไป SAP PI **UAT** (QAS) ของ Thai Namthip ผ่าน Kong
#
#   /sap-pi-uat/<path>  ->  https://qbx.thainamthip.co.th:8100/<path>   (qbx = SAP QAS · 119.63.88.132)
#   ใช้จริง:  /sap-pi-uat/XISOAPAdapter/MessageServlet?senderService=...&interface=WorkOrderUpdate_Out&interfaceNamespace=...
#   Prod (pbx) แยกอยู่ใน add-sap-pi-env-routes.sh — route /sap-pi-prod, service sap-pi-prod
#
# ประวัติ:
#   2026-09-29 สร้าง route /sap-pi (sap-pi-soap) บน service sap-pi
#   2026-09-30 Thai Namthip whitelist IP ขาออกของ Kong 20.6.32.81 (ทั้ง qbx และ pbx — เทส 401 ได้ทั้งคู่ 2026-10-07)
#   2026-10-07 แยก environment: service sap-pi -> เปลี่ยนชื่อเป็น sap-pi-uat · เพิ่ม route /sap-pi-uat (sap-pi-uat-soap)
#              ลบ route /sap-pi และ /sap-pi-test — D365 F&O UAT กลับไปยิง qbx ตรง ไม่ผ่าน Kong แล้ว
#              สคริปต์นี้จึงดูแล route sap-pi-uat-soap แทน sap-pi-soap
#
# ทำไมต้องผ่าน Kong: ได้ log ทุก call ที่ยิงเข้า SAP (request + response body) ลง kong_api_logs +
#   เห็น error ย้อนหลังได้ใน Grafana dashboard "SIMS → SAP"
#
# credential: ไม่เก็บใน Kong — ผู้เรียก (SIMS) ส่ง Authorization: Basic ของ SVC_NAV_01 มาเอง Kong แค่ส่งต่อ
#
# ip-restriction: **ปิดอยู่ (enabled=false) ตั้งแต่ 2026-10-08** — ผู้ดูแลสั่งเปิดให้ทุก IP ยิงได้ทั้ง UAT และ Prod
#   (IP บ้าน/ออฟฟิศเป็น dynamic โดนบล็อกบ่อย) · plugin และ allow list ข้างล่างยังเก็บไว้ ไม่ได้ลบ
#   ความเสี่ยงขณะปิด: Kong เป็น open relay — ใครก็ได้บน internet ยิงทะลุไปหา SAP
#   ด้วย IP 20.6.32.81 ที่ Thai Namthip whitelist ไว้ · บอทลองรหัสผิดจน SVC_NAV_01 ถูก lock ได้
#   สคริปต์นี้ PATCH แค่ allow list (ไม่แตะ enabled) · ถ้า plugin หายแล้ว POST ใหม่ จะได้ plugin ที่ enabled
#   เปิดกลับ: curl -X PATCH "$ADMIN/plugins/<id>" --data enabled=true
#   (log เคยเจอ Microsoft Teams 52.112.x และ LINE 147.92.179.x ตามไปเปิด link — ตอนเปิด ip-restriction โดน 403)
#   allow: 4.144.150.30/.42/.51/.52/.54/.57 = SIMS (App Service `Sims` · plan Sims-Paas · outboundIpAddresses · เพิ่ม 2026-10-07)
#            IP ของ App Service เปลี่ยนได้เมื่อ scale / เปลี่ยน tier — เช็ค: az webapp show -g WebApplication_group -n Sims
#            --subscription 88b5eba0-04b5-4234-b87e-2da5ac1b7725 --query outboundIpAddresses
#          10.0.0.4 / 20.33.118.76 = VM WebApplication (fo-gateway) · 20.44.247.33 = D365 F&O
#            (F&O UAT เลิกผ่าน Kong 2026-10-07 — ถอดได้ถ้าไม่กลับมาใช้)
#          127.0.0.1 / 172.16.0.0/12 = เทสจากบนตัว VM เอง (Kong เห็น source เป็น IP ของ docker bridge)
#          171.103.89.247, 87.124.104.34, 124.120.31.223, 124.122.190.153, 124.120.35.52 = IP ออฟฟิศ
#   IP ออฟฟิศเป็น dynamic เปลี่ยนเกือบทุกวัน — ผู้ดูแลตัดสินใจ 2026-10-01 ว่าให้ยิงจากออฟฟิศได้
#   เวลา IP เปลี่ยนให้รัน scripts/fix-my-ip.ps1 -IncludeKong แล้วเติม IP ใหม่ลงรายการข้างล่างด้วย
#   ไม่งั้นรันสคริปต์นี้ซ้ำจะเขียนทับหาย
#
# protocols = http + https (ผู้ดูแลตัดสินใจ 2026-10-07)
#   ⚠️ ถ้าผู้เรียกใช้ http header Basic auth ของ SVC_NAV_01 วิ่งแบบไม่เข้ารหัส — ให้ SIMS เรียก https เป็นหลัก
#   ip-restriction บังคับทั้ง http และ https · ฝั่ง service เป็น https เสมอ เพราะ SAP :8100 รับแค่ TLS
#
# หลังสร้างครั้งแรก ให้รัน add-response-body-capture.sh (เก็บ response) — add-jwt-user-plugin.sh มีชื่อ route นี้แล้ว
# idempotent: PUT ซ้ำได้ · ใช้: sh scripts/add-sap-egress-route.sh
# rollback: curl -X DELETE "$ADMIN/routes/sap-pi-uat-soap"
# =====================================================
ADMIN="${KONG_ADMIN:-http://localhost:8001}"
UPSTREAM="${SAP_PI_UPSTREAM_URL:-https://qbx.thainamthip.co.th:8100}"
PUBLIC_HOST="${KONG_PUBLIC_HOST:-bevprogateway.southeastasia.cloudapp.azure.com}"
ROUTE="sap-pi-uat-soap"

echo "=== service sap-pi-uat -> $UPSTREAM ==="
curl -s -o /dev/null -w "  PUT service sap-pi-uat -> %{http_code}\n" -X PUT "$ADMIN/services/sap-pi-uat" \
  --data "url=$UPSTREAM" \
  --data "connect_timeout=10000" --data "read_timeout=120000" --data "write_timeout=120000" \
  --data "retries=1" --data "tags[]=sap-egress" --data "tags[]=uat"
# retries=1 (default 5): ถ้า SAP บล็อก Kong จะลองใหม่ 5 รอบ x 10 วิ = client ค้างเกิน 45 วิ
# ทำให้แยกไม่ออกว่า "ถูกบล็อก" หรือ "ช้า" — ตั้ง 1 เพื่อให้ได้ 504 กลับมาเร็ว

echo "=== route /sap-pi-uat ($ROUTE · http + https) ==="
curl -s -o /dev/null -w "  PUT route $ROUTE -> %{http_code}\n" \
  -X PUT "$ADMIN/services/sap-pi-uat/routes/$ROUTE" \
  --data "paths[]=/sap-pi-uat" \
  --data "strip_path=true" \
  --data "protocols[]=http" --data "protocols[]=https" \
  --data "methods[]=POST" --data "methods[]=GET" --data "methods[]=HEAD" \
  --data "tags[]=sap-egress" --data "tags[]=uat"

echo "=== plugin ip-restriction (กัน open relay) ==="
# หา plugin id ด้วย python3 (grep หาไม่เจอ -> POST ซ้ำแล้วได้ 409 Conflict และ allow list ใหม่ไม่ถูกใช้ — เจอจริง 2026-09-29)
ALLOW="--data config.allow[]=4.144.150.30 --data config.allow[]=4.144.150.42 --data config.allow[]=4.144.150.51
  --data config.allow[]=4.144.150.52 --data config.allow[]=4.144.150.54 --data config.allow[]=4.144.150.57
  --data config.allow[]=10.0.0.4 --data config.allow[]=20.33.118.76 --data config.allow[]=20.44.247.33
  --data config.allow[]=171.103.89.247 --data config.allow[]=87.124.104.34 --data config.allow[]=124.120.31.223
  --data config.allow[]=124.122.190.153 --data config.allow[]=124.120.35.52
  --data config.allow[]=127.0.0.1 --data config.allow[]=172.16.0.0/12"
EXISTING=$(curl -s "$ADMIN/routes/$ROUTE/plugins" | python3 -c "import json,sys;d=json.load(sys.stdin).get('data',[]);print(next((p['id'] for p in d if p['name']=='ip-restriction'),''))" 2>/dev/null)
if [ -n "$EXISTING" ]; then
  # shellcheck disable=SC2086
  curl -s -o /dev/null -w "  ip-restriction (อัปเดต) -> %{http_code}\n" -X PATCH "$ADMIN/plugins/$EXISTING" $ALLOW
else
  # shellcheck disable=SC2086
  curl -s -o /dev/null -w "  ip-restriction (สร้าง) -> %{http_code}\n" -X POST "$ADMIN/routes/$ROUTE/plugins" \
    --data "name=ip-restriction" $ALLOW
fi

sleep 6

# --- เทสความพร้อม: ไม่ส่ง credential ดูแค่ว่า Kong ออกไปถึง SAP ไหม (ไม่นับเป็น login ผิด) ---
QS="senderService=sys_TNTLFTDNAVService&interface=WorkOrderUpdate_Out&interfaceNamespace=http://pi.coca-cola.com.th/tntl_i_processworkorder/sendfromnav/"
K="https://$PUBLIC_HOST/sap-pi-uat/XISOAPAdapter/MessageServlet"
RESOLVE="--resolve $PUBLIC_HOST:443:127.0.0.1"

echo "=== tests ==="
printf 'ผ่าน Kong ไป SAP QAS (ไม่ส่ง auth) : '
curl -sk $RESOLVE -o /dev/null -w '%{http_code}\n' --max-time 30 "$K?$QS"
echo
echo "อ่านผล: 401 = ถึง SAP แล้ว เหลือแค่ credential · 502/504 = SAP บล็อก IP Kong · 403 = ip-restriction ของเราเอง"
echo "URL ที่ให้ SIMS UAT ใช้: $K?$QS"
