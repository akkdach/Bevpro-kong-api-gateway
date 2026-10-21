# คู่มือการใช้งาน — Kong API Gateway บน Azure VM

> เซิร์ฟเวอร์: `WebApplication-kong-gateway` (Azure, 2 คอร์ / 3.8 GB RAM) — IP ถาวร: **20.6.32.81**
> โดเมน: **bevprogateway.southeastasia.cloudapp.azure.com** (https พร้อมใช้)
> อัปเดตล่าสุด: 22 ก.ค. 2026

## 🔐 Base URL แยกตามแอป

```
GW = https://bevprogateway.southeastasia.cloudapp.azure.com
```

| แอป | ตัวแปร | ค่า |
|---|---|---|
| **Mobile (UAT)** | `EXPO_PUBLIC_API_BASE_URL` | `GW/uat` **หรือ** `GW/uat/api/v1` (ลืม `api` หรือ `v1` ตัวใดตัวหนึ่งก็ผ่าน — regex `(?:/api)?(?:/v1)?`) |
| **Mobile (PROD)** | `EXPO_PUBLIC_API_BASE_URL` | `GW/prod` **หรือ** `GW/prod/api/v1` (เช่นเดียวกัน) |
| **pro-iot-board** | `REACT_APP_API_BASE_URL_ONE_LEKE` | `GW/api` |
| | `REACT_APP_API_BASE_URL_IOT` | `GW/iot/v1` |
| | `REACT_APP_API_BASE_URL_REVENUE` | `GW/revenue/v1` |
| | `REACT_APP_API_BASE_URL` (BEVProAPI) | เรียกตรง ไม่ผ่าน gateway |
| | `REACT_APP_API_BASE_URL_IMAGE` | เรียกตรง ไม่ผ่าน gateway |

- SSL: Let's Encrypt หมดอายุ 19 ต.ค. 2026 — ต่ออายุอัตโนมัติผ่าน cron (`scripts/renew-ssl.sh` วันละ 2 ครั้ง)
- cron บน VM (root): `renew-ssl.sh` 03:00/15:00 · `purge-log-bodies.sh` 02:30 ล้าง `request_body` / `response_body` / `request_headers` / `response_headers` เกิน 30 วัน (log `/var/log/purge-log-bodies.log`) · `refresh-report-rollups.sh` ทุก 6 ชม. · `sample-sqlserver-locks.sh` ทุก 1 นาที เก็บสถานะ lock ของ SQL Server (log `/var/log/kong-lock-sampler.log`)
- `http://` ยังใช้ได้ แต่ใช้ `https://` เสมอ ไม่งั้นเว็บที่เปิดด้วย https จะโดน mixed content บล็อก
- `/api/WizardConfig` ชี้ **prod เสมอ** แยก environment ไม่ได้ เพราะแอปตัด path เหลือแค่ host

## 🗺️ Service / Route ใน Kong

| service | upstream | route |
|---|---|---|
| `onelake-middleware` | Azure App Service | 68 เส้น (`/api/*`) sync จาก Swagger |
| `bevpro-uat` | `service.bevproasia.com:5001` | `/uat/*` catch-all + public 8 เส้น (`/Authen/token`, `/Authen/dispatchtoken`, `/auth/azure-login`, `/WorkOrderRoadMap`, `/close-type-update`, `/master/close-types`, `/master/part-set`, `/ChecklistMaster`) |
| `bevpro-prod` | `service.bevproasia.com` | `/prod/*` catch-all (+ rate-limiting 2000/นาที/consumer) + public 8 เส้น (ชุดเดียวกับ uat) + `/api/WizardConfig` + `/api/DisplayImage` |
| `material-images` | `service.bevproasia.com:7008` | `/matireal/*` รูปวัสดุ (ใช้ใน `<img>` ของ service-management ai-help — ไม่มี jwt เพราะ `<img>` แนบ header ไม่ได้) |
| `svc-management` (route `svc-all`) | `servicemanagement-...azurewebsites.net` | `/svc/*` **strip** catch-all — hub apps (safety, coffee, agentic, pro-iot ฯลฯ) เรียก SM ผ่านทางนี้ · ไม่มี jwt ของ Kong (มี endpoint auth ข้างใน, backend ตรวจ token เอง) · สร้างด้วย `scripts/add-web-backend-routes.sh` |
| `pm-backend` (route `pm-all`) | `webappbevpro-...azurewebsites.net` (ProjectManagement) | `/pm/*` **strip** catch-all — bevpro-agentic-app ใช้ · เงื่อนไขเดียวกับ `/svc` |
| `iot-service` | `iotservice.bevproasia.com/api/v1` | `/iot/v1` |
| `revenue-service` | `servicemanagement-...azurewebsites.net/api/v1` | `/revenue/v1` |
| `sims-uat` (route `sims-uat-all`) | `bevpro-sims-uat.azurewebsites.net` (BEVPRO SIMS — ชั้น integration ต่อ D365) | `/sims-uat/*` **strip** catch-all → `/sims-uat/api/v1/integrations/...` วิ่งไป `/api/v1/integrations/...` · **`protocols` = http,https** (เดิมตั้ง https อย่างเดียว · เปิด http เมื่อ 2026-09-17 ตามที่ผู้ดูแลตัดสินใจ ⚠️ ผ่าน http header Basic auth, client_secret และ PII ในใบงานวิ่งแบบไม่เข้ารหัส — ควรจำกัด IP ด้วย ip-restriction ถ้ามี client ที่ใช้ http จริง) · ไม่มี jwt ของ Kong — SIMS ตรวจสิทธิ์เอง 2 แบบแยกกันตาม namespace: `integrations/mobile/*` = REST+JSON ใช้ OAuth client_credentials (Bearer, scope `mobile.read`) · `integrations/sap/*` = **SOAP** ต้อง `POST` + `Content-Type: text/xml` + **Basic auth** (ถ้าส่ง JSON หรือ GET จะได้ 404 ไม่ใช่ 405 — เป็นเหตุที่เปิดในเบราว์เซอร์ไม่ได้) · เพิ่ม 2026-09-14 |
| `sims-uat-sap-service-orders` (route ชื่อเดียวกัน · tag `sims-sap`) | `bevpro-sims-uat.azurewebsites.net` **path `/api/v1/integrations/sap/service-orders`** | `/sims-uat/api/v1/integrations/sap/service-orders` **POST อย่างเดียว** · strip_path=true · http,https (เปิด http 2026-09-17) — แยกออกจาก `sims-uat-all` เพื่อให้ log มี `route_name` ของ SAP ต่างหาก และใส่ plugin เฉพาะเส้นนี้ได้ · Kong เลือก route นี้ก่อนเพราะ path ยาวกว่า · GET หรือ method อื่นตกไป `sims-uat-all` ตามเดิม · ⚠️ ต้องมี path ที่ service เสมอ ถ้าผูก route นี้เข้า service `sims-uat` (ไม่มี path) + strip_path=true Kong จะตัด path ทิ้งทั้งเส้นแล้วส่ง `/` ไป SIMS ได้ 404 · เพิ่ม 2026-09-17 |
| `inbound-mobile` | `https://soap.bevproasia.com:88` — ชื่อนี้ถูก override ใน container kong ให้ = `10.0.0.4` (private IP ของเครื่อง IIS ใน VNet, ดู `extra_hosts` ใน `docker-compose.override.vm.yml`) → traffic วิ่งภายใน VNet แต่ SNI/hostname ยังถูก (binding IIS บังคับชื่อ ยิงด้วย IP = 400 Invalid Hostname) | `/inbound-mobile/*` **strip** → app เสิร์ฟที่ root เช่น `/inbound-mobile/health/live` → `:88/health/live` · ยังไม่มี jwt (รอตัดสินใจ) · สร้าง/แก้ด้วย `scripts/add-inbound-mobile.sh [--strip] [--jwt]` |
| `d365fo-gateway` (route `d365fo-soap` · tag `d365fo`) | `http://fo-gateway.bevproasia.com` = IIS บน VM WebApplication (`10.0.0.4`) — service ตั้งเป็นชื่อโดเมน ไม่ใช่ IP เพราะ `preserve_host=false` ทำให้ Kong ส่ง `Host: fo-gateway.bevproasia.com` ตรงกับ site binding ของ IIS | `/d365fo/*` **strip** · **https อย่างเดียว** (http ได้ 426) · POST/GET/OPTIONS/HEAD · read/write timeout 120s (payload ใบงานใหญ่) · request-transformer ยัด `X-App-Name: d365fo` เพราะ D365 ส่งเองไม่ได้ · ยังไม่มี auth ที่ Kong — เฟสถัดไปใส่ basic-auth แล้วปิดทางตรงที่ IIS · ผู้เรียกคือ D365 F&O (`bevpro-uat.sandbox.operations.dynamics.com` หน้า Client configuration parameters) · operation หลัก `D365FoWorkOrderInboundSAP`, `TestConnect` (ใช้ทดสอบได้ ไม่เขียนข้อมูล) · สร้างด้วย `scripts/add-d365fo-route.sh` · เพิ่ม 2026-09-29 |
| `sap-pi-uat` (เดิมชื่อ `sap-pi` เปลี่ยน 2026-10-07 · route `sap-pi-uat-soap` `/sap-pi-uat` · route `sap-pi-soap` `/sap-pi` ลบแล้ว 2026-10-07 · tag `sap-egress` `uat`) | `https://qbx.thainamthip.co.th:8100` (SAP PI ของ Thai Namthip = `119.63.88.132`) — **qbx = SAP QAS (UAT)** คู่กับ D365 F&O UAT (`bevpro-uat.sandbox` ตั้ง Resource Url มาที่ Kong `/sap-pi`) · SAP PRD = `pbx.thainamthip.co.th:8100` ที่ F&O Prod ยิงตรง ไม่ผ่าน Kong (เช็ค 2026-10-07) · แยก environment แล้ว (2026-10-07): `/sap-pi-uat` → qbx และ `/sap-pi-prod` → pbx (service `sap-pi-prod`) ด้วย `scripts/add-sap-pi-env-routes.sh` · pbx อนุญาต IP Kong อยู่แล้ว · `/sap-pi` เดิมลบแล้ว (F&O UAT กลับไปยิง qbx ตรง) — ข้อความด้านขวาที่อ้าง `/sap-pi` คือประวัติของ route เดิม ตอนนี้ใช้กับ `/sap-pi-uat` (`add-sap-egress-route.sh` ดูแล `/sap-pi-uat` แล้ว) | `/sap-pi/*` **strip** — **ขาออก** ไม่ใช่ขาเข้า · **`protocols` = http,https** (เดิม https อย่างเดียว · เปิด http 2026-10-07 ตามที่ผู้ดูแลตัดสินใจ ⚠️ ผ่าน http header Basic auth ของ `SVC_NAV_01` วิ่งไม่เข้ารหัส · ip-restriction ยังบังคับทั้งสอง protocol · service ฝั่ง SAP ยังเป็น https) · `retries=1` เพื่อให้ล้มเร็วเป็น 504 แทนค้างยาว · **ip-restriction บังคับ** (allow: `10.0.0.4`, `20.33.118.76` = fo-gateway · `20.44.247.33` = D365 F&O ยืนยันจาก log 2026-10-01 · `4.144.150.30/.42/.51/.52/.54/.57` = **SIMS** (App Service `Sims` outbound IP เพิ่ม 2026-10-07 — เปลี่ยนได้เมื่อ scale/เปลี่ยน tier ระยะยาวควรย้ายไป key-auth) · `127.0.0.1`, `172.16.0.0/12` = เทสจากบน VM) — ถ้าถอดออก Kong กลายเป็น open relay ให้คนนอกยิงทะลุไป SAP ด้วย IP ที่ผ่าน whitelist ของเรา (log เคยเจอ Microsoft Teams `52.112.x` ตามไปเปิด link แล้วโดน 403 จริง) · IP ออฟฟิศอยู่ใน allow list ด้วย (ผู้ดูแลเลือก 2026-10-01 ให้เทสจากออฟฟิศได้) แต่เป็น dynamic IP เปลี่ยนเกือบทุกวัน → เจอ `IP address not allowed` ให้รัน `scripts/fix-my-ip.ps1 -IncludeKong` แล้วเติม IP ใหม่ใน `add-sap-egress-route.sh` · ผู้เรียกส่ง Basic auth ของ `SVC_NAV_01` มาเอง **Kong ไม่เก็บรหัสของคู่ค้า** · **Thai Namthip whitelist `20.6.32.81` ให้แล้ว 2026-09-30** (ทดสอบผ่าน Kong ได้ `401` ใน 0.55 วิ = ออกไปถึง SAP แล้ว เหลือแค่ credential · 2026-09-29 ก่อนหน้านั้นได้ `000`/504) · `20.33.118.76` ยังเปิดอยู่ ใช้คู่ขนานได้ · เทสสถานะ: ยิง `GET /sap-pi/XISOAPAdapter/MessageServlet` → 401 = ปกติ, 504 = ปลายทางบล็อกอีกแล้ว, 403 = โดน ip-restriction ของเราเอง · สร้างด้วย `scripts/add-sap-egress-route.sh` · เพิ่ม 2026-09-29 |
| ~~`sap-pi-test`~~ | **ลบแล้ว 2026-10-07** | route `/sap-pi-test` (key-auth) และ consumer `sap-tester` ถูกลบ — ผู้ดูแลเลือกใช้ ip-restriction อย่างเดียว · `scripts/add-sap-egress-test-route.sh` ถูกปิดไม่ให้รัน · ทางเทสปัจจุบัน = `/sap-pi-uat` |
| `acme-challenge` | nginx ภายใน | `/.well-known/acme-challenge` (ต่ออายุ SSL — **ห้ามลบ**) |

**consumer:** `BevProApp` (key = `http://www.xxx.com`) · `onelake-app` (สำรอง ยังไม่มีใครใช้)

### สคริปต์จัดการ route

```bash
python3 scripts/sync-routes-from-swagger.py --dry-run   # onelake — ดูก่อน
python3 scripts/sync-routes-from-swagger.py             # onelake — ลงจริง
python3 scripts/add-mobile-catchall.py                  # Mobile uat/prod (แบบ ANY) — รันเต็ม = ลบ+สร้าง route ใหม่ (ดับสั้นๆ)
python3 scripts/patch-mobile-regex.py --dry-run         # แก้ regex route mobile-env แบบ in-place ไม่ลบ route (plugin คงเดิม)
python3 scripts/add-mobile-public-route.py /auth/azure-login POST --dry-run   # เพิ่ม route public (login/ไม่ต้องมี JWT) ทีละเส้น ทั้ง uat+prod — แล้วเพิ่มใน PUBLIC ของ add-mobile-catchall.py ด้วย
python3 scripts/add-mobile-env-routes.py                # Mobile แบบ allowlist รายเส้น (ทางเลือก)
sh      scripts/add-jwt-user-plugin.sh                  # ติดตั้ง pre-function ดึงชื่อผู้ใช้จาก JWT
sh      scripts/add-response-body-capture.sh            # post-function เก็บ response body เส้น SAP (sims-uat-sap-service-orders, sap-pi-soap)
sh      scripts/add-d365fo-route.sh                     # D365 F&O SOAP ขาเข้า (/d365fo) + เทสเทียบกับยิงตรง
sh      scripts/add-sap-egress-route.sh                 # ขาออกไป SAP PI (/sap-pi) + ip-restriction — ผลเทส 504 = ยังรอ whitelist, 401 = พร้อมใช้
# (ยกเลิก 2026-10-07) scripts/add-sap-egress-test-route.sh — route /sap-pi-test + consumer sap-tester ถูกลบ สคริปต์หยุดตัวเองถ้ารัน
sh      scripts/add-sap-pi-env-routes.sh                # แยกขาออกตาม env: /sap-pi-uat → qbx (QAS) · /sap-pi-prod → pbx (PRD) · SIMS_PROD_IPS="..." เติม IP SIMS Prod
# Postman ทดสอบขาส่งไป SAP: postman/BevPro-Gateway-SAP.postman_collection.json (ไม่มีรหัสในไฟล์ — ใส่ apikey / sap_password / gw_password ในช่อง Current value)
#   ↑ ชุดเก่า: ยิงผ่าน /sap-pi-test (API key) และผ่าน F&O — route /sap-pi-test ถูกลบแล้ว ใช้ไม่ได้ · flow ปัจจุบันใช้ชุดข้างล่าง
# Postman SIMS ⇄ SAP ทั้ง 2 ขา: postman/BevPro-Gateway-SIMS-SAP.postman_collection.json (2026-10-07)
#   folder "SIMS to SAP" (/sap-pi, ip-restriction) + "SAP to SIMS" (/sims-uat/.../service-orders) · Basic auth ตั้งที่ระดับ folder
#   ใส่ sapPassword / simsPassword ใน Current value เท่านั้น · body ขากลับ = ใบงานจริงที่ปิด PII แล้ว
#   ไม่มีตัวกันส่งซ้ำ — ได้ 401 จาก SAP ให้หยุดทันที (SVC_NAV_01 ใช้ร่วมกับ F&O ผิดหลายครั้งถูกล็อก)
```

> route ที่สคริปต์สร้างจะติด tag (`swagger-sync` / `mobile-env`) — ตอนลบจะลบเฉพาะที่มี tag ของตัวเอง **route ที่เพิ่มมือใน Konga จึงไม่ถูกแตะ**
> ยกเว้น: route ที่เพิ่มมือแล้วติด tag `mobile-env` ต้องตั้งชื่อขึ้นต้น `mb-api-` (เช่น `mb-api-wizardconfig`, `mb-api-displayimage`) ไม่งั้น `add-mobile-catchall.py` รันเต็มจะลบทิ้ง

## 📊 ข้อมูลที่เก็บใน log (ตาราง `kong_api_logs`)

| คอลัมน์ | ได้มาจาก | ใช้ทำอะไร |
|---|---|---|
| `consumer_username` | Kong JWT plugin | แยกราย **แอป** |
| `jwt_user` | claim `sub` (ผ่าน pre-function) | แยกราย **คน** |
| `device_id` | header `Device_ID` จากแอป | แยกราย **เครื่อง** |
| `client_ip` · `user_agent` | Kong | เครือข่าย / ชนิดแอป |
| `request_size` + `response_size` | Kong | โควตาอินเทอร์เน็ต 20 GB (PROPOSAL 4.2) |
| `route_name` · `latency_ms` · `status_code` | Kong | วินิจฉัยปัญหา |
| `app_name` | header `X-App-Name` ที่ api client ของแต่ละ frontend ใส่มา (เริ่ม 2026-08-26 — service-management เป็นแอปแรก) | แยกราย **แอป** — consumer แยกไม่ได้เพราะทุกแอปใช้ token ชุดเดียวกัน · NULL = แอปเก่า/ยังไม่ใส่ header · ⚠️ header ใหม่จากเว็บต้องเพิ่มใน whitelist ของ cors plugin (global) ไม่งั้น browser block ตอน preflight |
| `request_body` | pre-function อ่าน body ที่ access phase (ตั้งแต่ 2026-08-21) | ดูว่าแอปส่งอะไรมา — เฉพาะ POST/PUT/PATCH ที่เป็น JSON/form/text ≤ 4 KB · **ยกเว้นเส้น interface XML** (`d365fo-soap`, `sap-pi-soap`, `sap-pi-uat-soap`, `sap-pi-prod-soap`, `sims-uat-sap-service-orders`, path `/integrations/sap/`) เก็บเต็มถึง 64 KB ตั้งแต่ 2026-10-06 ใช้เปิดดู XML ที่ส่งจริงย้อนหลังได้ · upload รูป (> 64 KB) ไม่เก็บ · `/Authen/token` = `[REDACTED login]` · field `password`/`pwd` = `***` (JSON, form และ XML element) · **ล้างอัตโนมัติเมื่อเกิน 30 วัน** (`scripts/purge-log-bodies.sh` cron 02:30) |
| `response_body` | post-function ระดับ route อ่าน response ที่ body_filter phase (ตั้งแต่ 2026-10-07 15:50) | **เฉพาะ** `sims-uat-sap-service-orders` และ `sap-pi-soap` — SIMS ตอบ 200 เสมอแล้วบอกผลจริงใน `<TYPE>` S/E + `<MESSAGE>` ไม่มีคอลัมน์นี้แยกไม่ออกว่าใบงานเข้าจริงไหม · เก็บสำเนา chunk ไม่แก้ response ที่ส่งให้ผู้เรียก · ลบ `Accept-Encoding` ก่อนส่งต่อ ให้ปลายทางตอบไม่บีบอัด · ≤ 64 KB · mask `password` · มี PII (SIMS ส่งใบงานทั้งใบกลับ) **ล้างพร้อม `request_body` ที่ 30 วัน** · สร้างด้วย `scripts/add-response-body-capture.sh` · ใช้ `post-function` เพราะ `pre-function` ระดับ route จะทับตัว global |
| `request_headers` / `response_headers` | log-receiver อ่านจาก `request.headers` / `response.headers` ที่ http-log ส่งมา (ตั้งแต่ 2026-10-14, JSONB) | **เฉพาะเส้น interface** (route `sap-pi-*`, `sims-uat-sap-service-orders`, `d365fo-soap`, path `/sap-pi*` และ `/integrations/sap/` รวม 404) ~100 แถว/วัน — แอปมือถือไม่เก็บ · ใช้ดูว่าผู้เรียกส่ง `Content-Type`/`SOAPAction`/`Host` อะไร และใครตอบ (`Server`, `X-Kong-Upstream-Latency`, `WWW-Authenticate`) · เก็บค่าตามที่ส่งมา (เจ้าของระบบตัดสินใจ 2026-10-14) รวม `Cookie`/`Set-Cookie` และ header ชื่อแปลกไม่มีค่า (ท่อนท้ายของ Basic auth ที่ SAP PI ตัดบรรทัดทุก 76 ตัว) — **ยกเว้น `authorization` ไม่เก็บรหัส** แสดงเป็น `Basic user=<บัญชี> pass_len=<ความยาวรหัส> b64_len=<ความยาว base64>` จาก field `auth_info` ที่ post-function ของ `scripts/add-response-body-capture.sh` (3 route) ถอดให้ · ไม่มี `auth_info` (route อื่น/แถวเก่า) = `[REDACTED]` · ค่าละ ≤ 500 ตัวอักษร ≤ 60 header · **ล้างพร้อม body ที่ 30 วัน** · dashboard SIMS→SAP / SAP→SIMS แสดงใน panel ตาราง body |

### ตารางเก็บสถานะ lock ของ SQL Server (เพิ่ม 2026-09-11)

อยู่ใน database `kong` เดียวกับ `kong_api_logs` เติมโดย cron `scripts/sample-sqlserver-locks.sh` ทุก 1 นาที (เก็บ 2 ตัวอย่างต่อรอบ ห่างกัน 30 วินาที) เก็บย้อนหลัง 30 วันแล้วล้างอัตโนมัติ

| ตาราง | เก็บอะไร | ใช้ตอบคำถามว่า |
|---|---|---|
| `sql_blocking_samples` | session ที่กำลังรอ lock + เลข session ที่ไปบล็อก + `program_name` ของตัวบล็อก | ใครถือ lock ตอนนั้น เป็นโค้ดของแอปหรือคนเปิด SSMS ค้างไว้ |
| `sql_lock_wait_samples` | ยอดสะสม `LCK_*` จาก `sys.dm_os_wait_stats` | ช่วงไหนมีการรอ lock เพิ่มขึ้นผิดปกติ (dashboard ทำ delta ให้) |
| `sql_index_usage_samples` | `user_seeks` / `user_scans` ของทุก index บน `Manpower_Operations` | index ที่สร้างไว้ยังถูกใช้อยู่ไหม หรือมี query ใหม่ที่ทำให้กลับไป scan ทั้งตาราง |

สร้างตารางด้วย `init-db/002-create-lock-sample-tables.sql` — ไฟล์ใน `init-db/` รันเฉพาะตอนสร้าง volume ครั้งแรก ถ้า DB มีอยู่แล้วให้ใช้ `sudo bash scripts/install-lock-sampler.sh` ซึ่งสร้างตาราง ดึง image ของ sqlcmd ทดสอบการต่อ และใส่ cron ให้ครบในคำสั่งเดียว

> ตัวเก็บตัวอย่างอ่าน DMV อย่างเดียว ไม่มีคำสั่งเขียนใด ๆ ต่อ SQL Server และจะข้ามตัวเองเงียบ ๆ ถ้ายังไม่ได้ตั้ง `MSSQL_GRAFANA_PASSWORD` ใน `.env`

> ⚠️ **ห้ามเก็บ JWT ทั้งใบ** — BEVProAPI ใส่รหัสผ่านผู้ใช้ไว้ใน claim `email` (`AuthenController.cs`) ดึงเฉพาะ `sub` เท่านั้น
> ⚠️ **ห้ามถอด redaction ของ `request_body`** ใน `scripts/add-jwt-user-plugin.sh` — body ของ `/Authen/token` คือ username+password ตัวจริง · body อื่นมี PII (ลูกค้า/GPS/พนักงาน) ใครเข้า Grafana/pgAdmin ได้เห็นหมด จึงเก็บแค่ 30 วัน

## 🚪 ตารางทางเข้าทั้งหมด

| ทางเข้า | ที่อยู่ (URL) | ใครเข้าได้ | ใช้ทำอะไร |
|---|---|---|---|
| **API Gateway** | `http://20.6.32.81` | ทุกคน | ทางเข้า API ของแอปมือถือ/เว็บ (ต้องแนบ token) |
| **คู่มือ API (Swagger)** | `http://20.6.32.81/api-docs` | ทุกคน | ดูรายการ API ทั้งหมดพร้อมวิธีเรียก |
| **เช็คระบบมีชีวิต** | `http://20.6.32.81/health` | ทุกคน | ตอบ 200 = ระบบปกติ |
| **Grafana** (กราฟสถิติ) | `http://20.6.32.81:3000` | เฉพาะ IP แอดมิน | ดูกราฟจำนวนเรียก API, ความเร็ว, การใช้งานราย Consumer |
| **Konga** (จัดการ Kong) | `http://20.6.32.81:1337` | เฉพาะ IP แอดมิน | เพิ่ม/แก้ routes, plugins, consumers ผ่านหน้าเว็บ |
| **Kong Manager** | `http://20.6.32.81:8002` | เฉพาะ IP แอดมิน | หน้าจัดการ Kong ตัวทางการ (ดูอย่างเดียวเป็นหลัก) |
| **Prometheus** | `http://20.6.32.81:9090` | เฉพาะ IP แอดมิน | ฐานข้อมูลสถิติดิบ (Grafana ดึงจากตัวนี้) |
| **Kong Admin API** | `http://20.6.32.81:8001` | เฉพาะ IP แอดมิน | สั่งงาน Kong ด้วยคำสั่ง/สคริปต์ |
| **รีโมทเข้าเครื่อง (SSH)** | `ssh adminwebapp@20.6.32.81` | เฉพาะ IP แอดมิน | พิมพ์คำสั่งควบคุมเซิร์ฟเวอร์ (ใช้ PowerShell ได้เลย) |
| ~~Postgres, Log Receiver, Metrics~~ | พอร์ต 5432, 3001, 8100 | ❌ ปิดตายจากภายนอก | ระบบภายในคุยกันเองใน Docker |

**IP แอดมินที่อนุญาตตอนนี้** (NSG 3 กฎ `Allow-SSH-AdminOnly` · `Allow-Admin-Dashboards` · `Allow-Postgres-Admin` + Kong ip-restriction ของ `grafana-admin` · `prometheus-admin`):

| IP | ขาเน็ตออฟฟิศ | หมายเหตุ |
|---|---|---|
| `87.124.104.32/29` | Symphony (เน็ตธุรกิจ) | ใส่ทั้งบล็อก 2026-10-14 — router สลับใช้ `.34`–`.38` ต่อ Azure ออกเป็น `.38` (เดิมใส่แค่ `.34` → SSH/Konga/Admin API timeout ทั้งที่ IP ตัวเองดูเหมือนอยู่ในรายการ) |
| `171.103.89.247` | TRUE INTERNET | |
| `124.120.28.131` · `124.120.31.223` · `124.122.190.153` · `124.120.35.52` | True Online (dynamic) | เปลี่ยนบ่อย เติมด้วย `scripts/fix-my-ip.ps1` เลขเก่าลบได้เมื่อไม่ใช้ |

> ⚠️ router ออฟฟิศสลับขาเน็ตต่อ connection — เว็บตรวจ IP (ifconfig.me) อาจตอบคนละเลขกับที่ Azure เห็น ดูเลขจริงด้วย `ssh ... 'echo ${SSH_CLIENT%% *}'` หรือข้อความ `IP address not allowed: x` ของ Kong

## 🔑 ชื่อผู้ใช้ / รหัสผ่านอยู่ที่ไหน

| ระบบ | ชื่อผู้ใช้ | รหัสผ่าน |
|---|---|---|
| Grafana | `admin` | เปลี่ยนเมื่อ 23 ก.ค. 2026 — ลืมแล้วรีเซ็ตใหม่ตามคำสั่งด้านล่าง (รหัสจริงไม่เก็บในไฟล์นี้เพราะขึ้น git) |
| Konga | `admin` | ดูในไฟล์ `konga-seed/userdb.data` บรรทัด `"password"` (gitignored) — เปลี่ยนรหัสต้องแก้ไฟล์นี้แล้ว re-seed |
| Kong Manager / Prometheus | — | ไม่มีระบบล็อกอิน (ปลอดภัยเพราะเปิดเฉพาะ IP แอดมิน) |

ลืมรหัส Grafana → รีเซ็ตทาง SSH (ได้ผลทันที ไม่ต้องรีสตาร์ท):

```bash
docker exec grafana grafana cli --homepath /usr/share/grafana admin reset-admin-password 'รหัสใหม่'
```

> หมายเหตุ: ค่า `GF_SECURITY_ADMIN_PASSWORD` ใน docker-compose มีผลเฉพาะตอนสร้าง Grafana **ครั้งแรก** เท่านั้น
> แก้ค่านั้นทีหลังแล้วรีสตาร์ทจะไม่เปลี่ยนรหัส — ต้องใช้คำสั่ง reset ข้างบน

### เปลี่ยนรหัส Konga (ยุ่งกว่า Grafana)

Konga เก็บรหัสแบบ hash ใน volume `konga_data` และสร้าง passport ใหม่ทุก login — **แก้ database ตรง ๆ ไม่ได้** (sails-disk เขียนทับ) วิธีที่ได้ผลจริง = re-seed จาก volume ว่าง:

```bash
# 1. แก้รหัสในไฟล์ seed
#    konga-seed/userdb.data -> "password": "รหัสใหม่"
# 2. ลบ volume แล้วให้ Konga seed ใหม่ (connection re-seed จาก kongnode.data ด้วย)
cd /home/adminwebapp/kong
docker compose stop konga && docker compose rm -f konga
docker volume rm kong_konga_data
docker compose up -d konga        # รอ ~40 วิ Konga จะ seed user + connection ใหม่
```

> ผลข้างเคียง: snapshots/settings ใน Konga หาย (ปกติไม่ได้ใช้) — user + connection ถูกสร้างใหม่จาก seed

## 🛠️ งานประจำของแอดมิน

### เพิ่ม IP แอดมินคนใหม่ (รันใน PowerShell เครื่องที่ล็อกอิน Azure CLI ไว้)

> แนะนำใช้สคริปต์ — หา IP ตัวเอง แล้วเติมให้ครบทั้ง NSG 3 กฎ + Kong `grafana-admin` / `prometheus-admin` โดยไม่ทับของเดิม:
>
> ```powershell
> .\scripts\fix-my-ip.ps1          # เพิ่ม -WhatIf เพื่อดูก่อน
> ```

ทำมือ — ⚠️ คำสั่งนี้**แทนที่รายการทั้งหมด** ต้องใส่ IP เดิมทุกตัว + ตัวใหม่ต่อท้ายเสมอ (และต้องทำครบ 3 กฎ):

```powershell
$ips = "171.103.89.247","87.124.104.32/29","124.120.28.131","124.120.31.223","124.122.190.153","124.120.35.52","IPใหม่"
foreach ($r in "Allow-SSH-AdminOnly","Allow-Admin-Dashboards","Allow-Postgres-Admin") { az network nsg rule update -g WEBAPPLICATION_GROUP --nsg-name WebApplication-kong-gateway-nsg -n $r --source-address-prefixes $ips -o none; "$r -> done" }
```

หรือคลิกเอง: portal.azure.com → VM `WebApplication-kong-gateway` → Networking → Network settings → คลิก `WebApplication-kong-gateway-nsg` → Inbound security rules → แก้ 2 กฎข้างบน (พิมพ์ IP ต่อท้าย คั่นด้วยจุลภาค)

### เข้าหน้าแอดมินไม่ได้ทั้งที่เมื่อวานยังได้

สาเหตุอันดับ 1: **IP ออฟฟิศเปลี่ยน** — เช็ค IP ปัจจุบันที่ https://ifconfig.me แล้วไปแก้กฎ 2 ข้อตามวิธีข้างบน (หน้า Azure Portal เข้าได้เสมอ ไม่ถูกกฎพวกนี้ปิด)
ถ้า IP จาก ifconfig.me ถูกแล้วแต่ยังเข้าไม่ได้: เน็ตอาจออกขาอื่นตอนคุยกับ Azure — เปิด `http://20.6.32.81/health` 1 ครั้ง แล้วไปดู IP จริงใน log: `docker logs kong-gateway --tail 20`

### ดูสถานะ / ดูล็อก / รีสตาร์ท (ผ่าน SSH)

```bash
cd /home/adminwebapp/kong
docker compose ps                      # สถานะทุกตัว (ต้องเป็น healthy/running)
docker stats --no-stream               # การใช้แรมเทียบเพดานที่ตั้งไว้
docker compose logs -f kong            # ดูล็อก Kong สด ๆ (Ctrl+C เพื่อออก)
docker compose restart kong            # รีสตาร์ทเฉพาะ Kong
docker compose up -d                   # รีสตาร์ท/อัปเดตทั้งระบบตามไฟล์ตั้งค่า
```

### เพิ่มแอปใหม่ให้เรียก API ได้ (สร้าง Consumer + กุญแจ JWT)

```bash
curl -X PUT http://localhost:8001/consumers/new-app --data "custom_id=new-app"
curl -X POST http://localhost:8001/consumers/new-app/jwt \
  --data "key=new-app" --data "algorithm=HS256" --data-urlencode "secret=รหัสลับของแอปใหม่"
```

## 📱 สำหรับนักพัฒนาแอป

1. **ขอ token:** `POST http://20.6.32.81/api/auth/login` (แนบ Entra ID token) → ได้ JWT อายุ 24 ชม.
2. **เรียก API:** แนบ header `Authorization: Bearer <token>` ทุกครั้ง → `http://20.6.32.81/api/...`
3. **เพดานการเรียก:** 200 ครั้ง/นาที ต่อแอป (เส้น `/api/sync/*` = 10 ครั้ง/นาที) — เกินแล้วได้ HTTP 429
4. รายละเอียดทุกเส้นทางดูที่ `http://20.6.32.81/api-docs`

## ⚠️ ข้อจำกัดปัจจุบัน

- ยังเป็น `http` (ไม่เข้ารหัส) — งานถัดไปคือผูกโดเมน + ใบรับรอง SSL แล้วเปิดพอร์ต 443 ที่จองไว้
- พอร์ต 8443 ตอบแบบเข้ารหัสได้แต่ใช้ใบรับรองชั่วคราว เบราว์เซอร์จะเตือน
- การตั้งค่าจูนเครื่องอยู่ใน `docker-compose.override.yml` บนเซิร์ฟเวอร์ (สำเนา: `docker-compose.override.vm.yml` ในโปรเจกต์นี้)
