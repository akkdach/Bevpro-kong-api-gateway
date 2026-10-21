#!/bin/sh
# =====================================================
# add-sap-pi-env-routes.sh — แยกขาออกไป SAP PI ตาม environment (เพิ่ม 2026-10-07)
#
#   /sap-pi-prod/<path>  ->  https://pbx.thainamthip.co.th:8100/<path>   SAP PRD  (service sap-pi-prod)   ← สคริปต์นี้
#   /sap-pi-uat/<path>   ->  https://qbx.thainamthip.co.th:8100/<path>   SAP QAS  (service sap-pi-uat)    ← add-sap-egress-route.sh
#
# ที่มาของการแยก (เช็คหน้า Client configuration parameters ของ D365 2026-10-07):
#   qbx = SAP QAS (คู่กับ D365 F&O UAT) · pbx = SAP PRD (D365 F&O Prod ยิงตรง ไม่ผ่าน Kong)
#   path /sap-pi เดิมไม่บอก environment -> ลบแล้ว 2026-10-07 (F&O UAT กลับไปยิง qbx ตรง)
#
# ip-restriction ของ prod: เฉพาะเทสบนตัว VM (127.0.0.1, 172.16.0.0/12) + IP ใน SIMS_PROD_IPS — ห้ามใส่ IP ออฟฟิศ
#   ใส่ IP ของ SIMS Prod เมื่อรู้: SIMS_PROD_IPS="a.b.c.d e.f.g.h" sh scripts/add-sap-pi-env-routes.sh
#   ⚠️ รันแต่ละครั้งเขียน allow list ใหม่ทั้งชุด — ต้องใส่ SIMS_PROD_IPS ครบทุกครั้ง ไม่งั้น IP ที่เคยใส่จะหาย
#
# pbx อนุญาต IP ขาออกของ Kong 20.6.32.81 อยู่แล้ว — ติดตั้งครั้งแรก 2026-10-07 เทสจากบน VM ได้ 401 จาก SAP NetWeaver
#   ทั้ง qbx และ pbx (= ต่อถึง เหลือแค่ credential) · ถ้าวันหนึ่งได้ 504/000 = ปลายทางบล็อก IP Kong อีกแล้ว
#
# หลังรันสคริปต์นี้ ให้รันต่อ (ถ้ายังไม่เคยรันหลังเพิ่ม route):
#   sh scripts/add-response-body-capture.sh   # เก็บ response body ของ route ใหม่
#   sh scripts/add-jwt-user-plugin.sh         # FULL_BODY มีชื่อ route ใหม่ = เก็บ request body ถึง 64 KB
#
# idempotent: PUT ซ้ำได้ · ใช้: sh scripts/add-sap-pi-env-routes.sh
# rollback:
#   curl -X DELETE "$ADMIN/routes/sap-pi-prod-soap" && curl -X DELETE "$ADMIN/services/sap-pi-prod"
# =====================================================
ADMIN="${KONG_ADMIN:-http://localhost:8001}"
PROD_UPSTREAM="${SAP_PI_PROD_UPSTREAM_URL:-https://pbx.thainamthip.co.th:8100}"
PUBLIC_HOST="${KONG_PUBLIC_HOST:-bevprogateway.southeastasia.cloudapp.azure.com}"
SIMS_PROD_IPS="${SIMS_PROD_IPS:-}"

# PATCH ip-restriction ถ้ามีแล้ว ไม่งั้น POST · $1 = route, ที่เหลือ = allow list
set_allow() {
  R="$1"; shift
  ARGS=""
  for ip in "$@"; do ARGS="$ARGS --data config.allow[]=$ip"; done
  PID=$(curl -s "$ADMIN/routes/$R/plugins" | python3 -c "import json,sys;d=json.load(sys.stdin).get('data',[]);print(next((p['id'] for p in d if p['name']=='ip-restriction'),''))" 2>/dev/null)
  if [ -n "$PID" ]; then
    # shellcheck disable=SC2086
    curl -s -o /dev/null -w "  ip-restriction $R (อัปเดต $# IP) -> %{http_code}\n" -X PATCH "$ADMIN/plugins/$PID" $ARGS
  else
    # shellcheck disable=SC2086
    curl -s -o /dev/null -w "  ip-restriction $R (สร้าง $# IP) -> %{http_code}\n" -X POST "$ADMIN/routes/$R/plugins" --data "name=ip-restriction" $ARGS
  fi
}

echo "=== PROD: service sap-pi-prod -> $PROD_UPSTREAM ==="
curl -s -o /dev/null -w "  PUT service sap-pi-prod -> %{http_code}\n" -X PUT "$ADMIN/services/sap-pi-prod" \
  --data "url=$PROD_UPSTREAM" \
  --data "connect_timeout=10000" --data "read_timeout=120000" --data "write_timeout=120000" \
  --data "retries=1" --data "tags[]=sap-egress" --data "tags[]=prod"
curl -s -o /dev/null -w "  PUT route sap-pi-prod-soap -> %{http_code}\n" \
  -X PUT "$ADMIN/services/sap-pi-prod/routes/sap-pi-prod-soap" \
  --data "paths[]=/sap-pi-prod" --data "strip_path=true" \
  --data "protocols[]=http" --data "protocols[]=https" \
  --data "methods[]=POST" --data "methods[]=GET" --data "methods[]=HEAD" \
  --data "tags[]=sap-egress" --data "tags[]=prod"
# shellcheck disable=SC2086
set_allow sap-pi-prod-soap 127.0.0.1 172.16.0.0/12 $SIMS_PROD_IPS

sleep 6

# --- เทส: ไม่ส่ง credential (ไม่นับเป็น login ผิด) · ยิงจากบน VM (Kong เห็น IP docker bridge = อยู่ใน allow) ---
K="https://$PUBLIC_HOST"
RESOLVE="--resolve $PUBLIC_HOST:443:127.0.0.1"
echo "=== tests (จากบน VM) ==="
printf '  /sap-pi-prod (pbx) : '; curl -sk $RESOLVE -o /dev/null -w '%{http_code}\n' --max-time 30 "$K/sap-pi-prod/XISOAPAdapter/MessageServlet"
echo
echo "อ่านผล: 401 = ถึง SAP แล้ว (รอแค่ credential) · 502/504/000 = SAP ยังไม่ whitelist IP Kong · 403 = ip-restriction ของเราเอง"
