#!/bin/sh
# =====================================================
# add-inbound-mobile.sh — เพิ่ม service + route "inbound-mobile" ใน Kong
#
#   client: https://<gateway>/inbound-mobile/<path>
#   Kong  -> https://soap.bevproasia.com:88/inbound-mobile/<path>   (strip_path=false)
#
# ทำไมใช้ hostname ไม่ใช่ 10.0.0.4: binding ของ IIS บน :88 เป็น HTTPS ผูกกับชื่อ
#   soap.bevproasia.com (SNI) — ชี้ด้วย IP เปล่า Kong ไม่ส่ง SNI ที่ถูก → เลือก site ผิด/handshake พัง
#   soap.bevproasia.com = 20.33.118.76 = เครื่อง IIS เดียวกับ service.bevproasia.com (10.0.0.4 ใน VNet)
#
# ถ้า site บน :88 เสิร์ฟที่ root (ไม่มี /inbound-mobile นำหน้า) ให้รันด้วย --strip
#   -> strip_path=true  : /inbound-mobile/<path> -> http://10.0.0.4:88/<path>
#
# JWT: ค่าเริ่มต้นไม่ใส่ (รอตัดสินใจ) — ใส่ด้วย --jwt (ใช้ consumer/secret ชุดเดียวกับ mobile)
#
# idempotent: PUT ซ้ำได้ · ใช้: sh add-inbound-mobile.sh [--strip] [--jwt]
# =====================================================
ADMIN="${KONG_ADMIN:-http://localhost:8001}"
UPSTREAM="${INBOUND_MOBILE_UPSTREAM:-https://soap.bevproasia.com:88}"
STRIP=false
JWT=false
for a in "$@"; do
  case "$a" in
    --strip) STRIP=true ;;
    --jwt)   JWT=true ;;
  esac
done

echo "=== service inbound-mobile -> $UPSTREAM ==="
curl -s -o /dev/null -w "  PUT service -> %{http_code}\n" -X PUT "$ADMIN/services/inbound-mobile" \
  --data "url=$UPSTREAM" \
  --data "connect_timeout=10000" --data "read_timeout=60000" --data "write_timeout=60000"

echo "=== route /inbound-mobile (strip_path=$STRIP) ==="
curl -s -o /dev/null -w "  PUT route -> %{http_code}\n" -X PUT "$ADMIN/services/inbound-mobile/routes/inbound-mobile" \
  --data "paths[]=/inbound-mobile" \
  --data "strip_path=$STRIP" \
  --data "preserve_host=false" \
  --data "tags[]=inbound-mobile"

if [ "$JWT" = true ]; then
  HAS=$(curl -s "$ADMIN/routes/inbound-mobile/plugins" | grep -c '"name":"jwt"')
  if [ "$HAS" = "0" ]; then
    curl -s -o /dev/null -w "  POST jwt plugin -> %{http_code}\n" -X POST "$ADMIN/routes/inbound-mobile/plugins" \
      --data "name=jwt" --data "config.key_claim_name=iss" --data "config.claims_to_verify[]=exp"
  else
    echo "  jwt plugin already present"
  fi
fi

echo "=== verify ==="
curl -s "$ADMIN/routes/inbound-mobile" | tr ',' '\n' | grep -E '"paths"|"strip_path"|"name"' | head -4
printf "  upstream direct: "; curl -s -o /dev/null -w "%{http_code}\n" -m 5 "$UPSTREAM/inbound-mobile/" || true
