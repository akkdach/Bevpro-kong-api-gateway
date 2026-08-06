#!/bin/sh
# =====================================================
# add-konga-https.sh — เสิร์ฟ Konga ผ่านโดเมน konga.bevproasia.com (HTTPS)
#
# เงื่อนไขก่อนรัน: DNS A record `konga.bevproasia.com -> 20.6.32.81` ต้องมีผลแล้ว
# (ขอจากคนดูแลโดเมน bevproasia.com — สคริปต์เช็คให้ก่อน ถ้ายังไม่มีจะหยุดเอง)
#
# ทำ 5 ขั้น:
#   1. เช็ค DNS
#   2. ขยายใบรับรอง Let's Encrypt เดิมให้ครอบโดเมนใหม่ (--expand)
#      -> renew-ssl.sh เดิมต่ออายุให้อัตโนมัติต่อไป ไม่ต้องตั้งอะไรเพิ่ม
#   3. แก้ permission (เหมือน renew-ssl.sh)
#   4. kong reload โหลดใบใหม่
#   5. สร้าง service/route ใน Kong: host konga.bevproasia.com -> konga:1337
#      + ip-restriction เฉพาะ IP แอดมิน (Konga อยู่ใต้ host ตรง ไม่ใช่ path ย่อย -> ไม่พัง)
# =====================================================
set -e
DOMAIN="konga.bevproasia.com"
VM_IP="20.6.32.81"
ADMIN="${KONG_ADMIN:-http://localhost:8001}"

echo "[1/5] เช็ค DNS ของ $DOMAIN"
RESOLVED=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1)
if [ "$RESOLVED" != "$VM_IP" ]; then
  echo "  ❌ DNS ยังไม่พร้อม (ได้: '${RESOLVED:-ไม่มี}' ต้องการ: $VM_IP)"
  echo "  ขอ A record จากคนดูแลโดเมนก่อน แล้วรอ 5-30 นาทีค่อยรันใหม่"
  exit 1
fi
echo "  ✅ ชี้มาที่ $VM_IP แล้ว"

echo "[2/5] ขยายใบรับรองเดิม (--expand)"
CERTNAME=$(docker run --rm -v kong_certbot_conf:/etc/letsencrypt certbot/certbot certificates 2>/dev/null \
  | grep 'Certificate Name' | head -1 | sed 's/.*: //')
EXISTING_DOMAINS=$(docker run --rm -v kong_certbot_conf:/etc/letsencrypt certbot/certbot certificates 2>/dev/null \
  | grep 'Domains:' | head -1 | sed 's/.*Domains: //')
echo "  ใบเดิม: $CERTNAME ($EXISTING_DOMAINS)"
DOMAIN_ARGS=""
for d in $EXISTING_DOMAINS $DOMAIN; do DOMAIN_ARGS="$DOMAIN_ARGS -d $d"; done
docker run --rm \
  -v kong_certbot_conf:/etc/letsencrypt \
  -v kong_certbot_www:/var/www/certbot \
  certbot/certbot certonly \
    --webroot -w /var/www/certbot \
    --cert-name "$CERTNAME" \
    --expand --non-interactive --agree-tos --keep-until-expiring \
    $DOMAIN_ARGS

echo "[3/5] แก้ permission ให้ Kong อ่านได้"
docker run --rm -v kong_certbot_conf:/etc/letsencrypt alpine sh -c '
  chgrp -R 1000 /etc/letsencrypt/archive /etc/letsencrypt/live
  chmod 750 /etc/letsencrypt/archive /etc/letsencrypt/live
  chmod 750 /etc/letsencrypt/archive/*/ /etc/letsencrypt/live/*/
  chmod 640 /etc/letsencrypt/archive/*/*.pem
'

echo "[4/5] kong reload"
docker exec kong-gateway kong reload

echo "[5/5] Kong service/route/ip-restriction"
curl -s -o /dev/null -w "  konga-internal -> %{http_code}\n" \
  -X PUT "$ADMIN/services/konga-internal" \
  --data "url=http://konga:1337"

curl -s -o /dev/null -w "  konga-admin -> %{http_code}\n" \
  -X PUT "$ADMIN/services/konga-internal/routes/konga-admin" \
  --data "hosts[]=$DOMAIN" --data "protocols[]=https" \
  --data "preserve_host=true" \
  --data "tags[]=admin-ui"
# preserve_host=true — บทเรียนจาก Grafana (CSRF "origin not allowed")

EXISTING=$(curl -s "$ADMIN/routes/konga-admin/plugins" | python3 -c "
import sys, json
for p in json.load(sys.stdin)['data']:
    if p['name'] == 'ip-restriction':
        print(p['id']); break
")
if [ -n "$EXISTING" ]; then
  curl -s -o /dev/null -w "  ip-restriction (อัปเดต) -> %{http_code}\n" -X PATCH "$ADMIN/plugins/$EXISTING" \
    --data "config.allow[]=171.103.89.247" --data "config.allow[]=87.124.104.34"
else
  curl -s -o /dev/null -w "  ip-restriction (สร้าง) -> %{http_code}\n" -X POST "$ADMIN/routes/konga-admin/plugins" \
    --data "name=ip-restriction" \
    --data "config.allow[]=171.103.89.247" --data "config.allow[]=87.124.104.34"
fi

echo "done — เปิด https://$DOMAIN (แม่กุญแจเขียว, เฉพาะ IP ออฟฟิศ)"
