#!/bin/sh
# =====================================================
# renew-ssl.sh — ต่ออายุ Let's Encrypt certificate อัตโนมัติ
#
# ติดตั้งใน cron ของ root ให้รันวันละ 2 ครั้ง (certbot จะต่ออายุจริง
# เฉพาะตอนเหลือ < 30 วัน นอกนั้นจบเงียบ ๆ)
#   0 3,15 * * * /home/adminwebapp/kong/scripts/renew-ssl.sh >> /var/log/renew-ssl.log 2>&1
#
# 3 ขั้นตอน — ขาดขั้นไหนไม่ได้:
#   1. certbot renew (webroot ผ่าน Kong route /.well-known/acme-challenge)
#   2. แก้ permission ใหม่ — certbot สร้างไฟล์ใหม่เป็น root 0600 ทุกครั้ง
#      ถ้าไม่แก้ Kong (รันด้วย uid 1000) จะอ่านไม่ได้แล้วไม่ยอม start
#   3. kong reload — โหลด cert ใหม่โดยไม่ตัด connection ที่ค้างอยู่
# =====================================================
set -e
cd /home/adminwebapp/kong

echo "===== $(date '+%Y-%m-%d %H:%M:%S') renew-ssl ====="

echo "[1/3] certbot renew"
docker run --rm \
  -v kong_certbot_conf:/etc/letsencrypt \
  -v kong_certbot_www:/var/www/certbot \
  certbot/certbot renew \
    --webroot -w /var/www/certbot \
    --quiet

echo "[2/3] แก้ permission ให้ user kong (uid/gid 1000) อ่านได้"
docker run --rm -v kong_certbot_conf:/etc/letsencrypt alpine sh -c '
  chgrp -R 1000 /etc/letsencrypt/archive /etc/letsencrypt/live
  chmod 750 /etc/letsencrypt/archive /etc/letsencrypt/live
  chmod 750 /etc/letsencrypt/archive/*/ /etc/letsencrypt/live/*/
  chmod 640 /etc/letsencrypt/archive/*/*.pem
'

echo "[3/3] kong reload"
docker exec kong-gateway kong reload

echo "วันหมดอายุปัจจุบัน:"
docker run --rm -v kong_certbot_conf:/etc/letsencrypt certbot/certbot certificates 2>/dev/null \
  | grep -E 'Certificate Name|Expiry'

echo "done"
