#!/bin/sh
# =====================================================
# add-d365fo-route.sh — เอาขาเข้าของ D365 F&O SOAP gateway มาผ่าน Kong
#
#   /d365fo/<path>  ->  http://fo-gateway.bevproasia.com/<path>   (IIS บน VM WebApplication 10.0.0.4)
#
# ทำไม: D365 F&O (bevpro-uat.sandbox.operations.dynamics.com) เรียก
#       http://fo-gateway.bevproasia.com/D365FoService.svc ตรงๆ ด้วย Basic auth (user fando)
#       -> วิ่งบน http ไม่เข้ารหัส, ไม่มี log, ไม่มี rate limit, เรียกได้จากทั้ง internet
#       ย้ายมาผ่าน Kong เพื่อได้ https (cert เดิมของ gateway) + log ลง kong_api_logs + จำกัด rate ได้
#
# ขอบเขต: ขาเข้าเท่านั้น (D365 -> เรา)
#       ขาออก fo-gateway -> SAP PI (qbx.thainamthip.co.th:8100) ยังวิ่งตรงเหมือนเดิม
#       ห้ามเอาขาออกมาผ่าน Kong: SAP ฝั่ง Thai Namthip whitelist IP 20.33.118.76 ไว้
#       ถ้าวิ่งผ่าน Kong ต้นทางจะกลายเป็น 20.6.32.81 แล้วโดนบล็อก
#
# service url ตั้งเป็น "ชื่อโดเมน" ไม่ใช่ 10.0.0.4 เพราะ preserve_host=false (ค่า default)
# ทำให้ Kong ส่ง Host: fo-gateway.bevproasia.com ไปให้ IIS ตรงกับ site binding
#
# ยังไม่ใส่ auth ในสคริปต์นี้ (เฟส 1 = พิสูจน์ว่า SOAP ผ่าน Kong ได้เหมือนยิงตรง)
# เฟส 2 ค่อยเพิ่ม basic-auth plugin + consumer ของ D365 แล้วปิดทางตรงที่ IIS
#
# operation ที่ service นี้มี (จาก WSDL 2026-09-28): TestConnect, ConfigSettings,
#   D365FoWorkOrderInboundSAP, D365FoWorkOrderInboundGateway, WorkOrderInbound/Outbound,
#   WorkOrderOutboundSanden, AssetMaterialMasterOutbound, CallGetToken, QIInfomation,
#   SimulateCreateSalesOrderMobile, getCatalogProfile
#
# หมายเหตุ WSDL: ข้างในฝัง absolute URL (http://fo-gateway.bevproasia.com/...?xsd=xsdN)
#   client ที่ดึง ?wsdl ผ่าน Kong จะได้ URL ที่ชี้กลับทางตรง — D365 ใช้ URL ที่กรอกในหน้า
#   Client configuration parameters ตรงๆ จึงไม่กระทบ แต่ถ้าจะให้ WSDL ชี้มาที่ Kong
#   ต้องแก้ฝั่ง WCF (useRequestHeadersForMetadataAddress) ไม่ใช่แก้ที่ Kong
#
# idempotent: PUT ซ้ำได้ · ใช้: sh add-d365fo-route.sh
# rollback:
#   curl -X DELETE "$ADMIN/services/d365fo-gateway/routes/d365fo-soap"
#   curl -X DELETE "$ADMIN/services/d365fo-gateway"
# =====================================================
ADMIN="${KONG_ADMIN:-http://localhost:8001}"
UPSTREAM="${D365FO_UPSTREAM_URL:-http://fo-gateway.bevproasia.com}"
PUBLIC_HOST="${KONG_PUBLIC_HOST:-bevprogateway.southeastasia.cloudapp.azure.com}"

echo "=== service d365fo-gateway -> $UPSTREAM ==="
# read/write timeout 120s: payload ใบงานที่มีรายการเยอะใช้เวลานานกว่า REST ปกติ
curl -s -o /dev/null -w "  PUT service d365fo-gateway -> %{http_code}\n" -X PUT "$ADMIN/services/d365fo-gateway" \
  --data "url=$UPSTREAM" \
  --data "connect_timeout=10000" --data "read_timeout=120000" --data "write_timeout=120000"

echo "=== route /d365fo (https เท่านั้น) ==="
# strip_path=true : /d365fo/D365FoService.svc -> /D365FoService.svc
# protocols=https : บังคับเข้ารหัส (http จะได้ 426 Upgrade Required)
# GET ไว้ดึง ?wsdl / ?xsd , POST คือตัว SOAP จริง
curl -s -o /dev/null -w "  PUT route d365fo-soap -> %{http_code}\n" \
  -X PUT "$ADMIN/services/d365fo-gateway/routes/d365fo-soap" \
  --data "paths[]=/d365fo" \
  --data "strip_path=true" \
  --data "protocols[]=https" \
  --data "methods[]=POST" --data "methods[]=GET" \
  --data "methods[]=OPTIONS" --data "methods[]=HEAD" \
  --data "tags[]=d365fo"

echo "=== plugin request-transformer (ยัด X-App-Name ให้ dashboard แยกแอปออก) ==="
# D365 ไม่ส่ง header X-App-Name มาเอง (แก้ฝั่ง D365 ไม่ได้ — เป็น config สำเร็จรูป)
# ยัดที่ Kong แทน -> log-receiver อ่านเข้าคอลัมน์ app_name -> เห็นใน Grafana "สรุปรายแอป"
# หา plugin id ด้วย python3: grep หาไม่เจอแล้ว POST ซ้ำจะได้ 409 Conflict
RT=$(curl -s "$ADMIN/routes/d365fo-soap/plugins" | python3 -c "import json,sys;d=json.load(sys.stdin).get('data',[]);print(next((p['id'] for p in d if p['name']=='request-transformer'),''))" 2>/dev/null)
if [ -n "$RT" ]; then
  curl -s -o /dev/null -w "  request-transformer (อัปเดต) -> %{http_code}\n" -X PATCH "$ADMIN/plugins/$RT" \
    --data "config.add.headers[]=X-App-Name:d365fo"
else
  curl -s -o /dev/null -w "  request-transformer (สร้าง) -> %{http_code}\n" -X POST "$ADMIN/routes/d365fo-soap/plugins" \
    --data "name=request-transformer" \
    --data "config.add.headers[]=X-App-Name:d365fo"
fi

sleep 6

# --- เทส: ผ่าน Kong ต้องได้ผลเท่ากับยิงตรง ---
# --resolve ชี้ชื่อ public ของ gateway มาที่ 127.0.0.1 -> เทสจากบน VM ได้โดยไม่ต้องออก internet
K="https://$PUBLIC_HOST/d365fo/D365FoService.svc"
D="$UPSTREAM/D365FoService.svc"
RESOLVE="--resolve $PUBLIC_HOST:443:127.0.0.1"
ENVELOPE='<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><TestConnect xmlns="http://tempuri.org/"><InputText>kong-route-check</InputText></TestConnect></s:Body></s:Envelope>'

echo "=== tests ==="

printf 'WSDL  ผ่าน Kong : '
curl -sk $RESOLVE -o /dev/null -w '%{http_code}' --max-time 20 "$K?wsdl"
printf '   ยิงตรง : '
curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 "$D?wsdl"

printf 'SOAP  ผ่าน Kong : '
curl -sk $RESOLVE --max-time 30 -X POST "$K" \
  -H 'Content-Type: text/xml; charset=utf-8' \
  -H 'SOAPAction: "http://tempuri.org/ID365FoService/TestConnect"' \
  --data-binary "$ENVELOPE" | grep -o '<a:Status>[^<]*</a:Status>' || echo '(ไม่พบ Status — ดู response เต็มด้วยคำสั่งใน README)'

printf 'SOAP  ยิงตรง   : '
curl -s --max-time 30 -X POST "$D" \
  -H 'Content-Type: text/xml; charset=utf-8' \
  -H 'SOAPAction: "http://tempuri.org/ID365FoService/TestConnect"' \
  --data-binary "$ENVELOPE" | grep -o '<a:Status>[^<]*</a:Status>' || echo '(ไม่พบ Status)'

printf 'http ต้องถูกปฏิเสธ (คาดหวัง 426) : '
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 "http://localhost/d365fo/D365FoService.svc?wsdl"

echo
echo "ถ้า Status=true ทั้งสองบรรทัด -> URL ใหม่ที่ให้ D365 ใช้:"
echo "  $K"
echo "SoapAction เดิมไม่เปลี่ยน: http://tempuri.org/ID365FoService/D365FoWorkOrderInboundSAP"
echo "เฟสถัดไป: เพิ่ม basic-auth plugin + consumer ของ D365 แล้วค่อยปิดทางตรงที่ IIS"
