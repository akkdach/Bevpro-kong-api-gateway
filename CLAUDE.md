# CLAUDE.md — กติกาสำหรับ AI ใน repo นี้

Kong API Gateway (Kong 3.5 + Postgres 15) บน **Azure VM** `WebApplication-kong-gateway` (20.6.32.81)
เป็นทางเข้า API ให้แอปมือถือ/เว็บ ~400 ผู้ใช้ — JWT auth, rate limit, log pipeline, Prometheus/Grafana
repo นี้คือ **config + สคริปต์ ops** ไม่ใช่แอปที่ build/test ในเครื่อง — ของจริงรันด้วย docker compose บน VM

| | |
|---|---|
| ระบบจริง (production) | `https://bevprogateway.southeastasia.cloudapp.azure.com` (VM 20.6.32.81, user `adminwebapp`, key `%USERPROFILE%\.ssh\kong_vm`) |
| มาตรฐานเอกสาร | `docs/ST-documentation-standard.md` — ไฟล์ใหม่ใน `docs/` ต้องชื่อ `<PREFIX>-<slug>.md` |

## โครง repo

| ที่ | คือ |
|---|---|
| `docker-compose.yml` | นิยามระบบทั้งหมด: kong, kong-database, konga, log-receiver, onelake-middleware, prometheus, grafana |
| `docker-compose.override.vm.yml` | ค่า override ของ Azure VM (RAM 3.8GB) + `pg-bridge` — บน VM ไฟล์นี้ชื่อ `docker-compose.override.yml` |
| `docker-compose.nas.yml` | เวอร์ชัน Synology NAS — ต่างแค่ host port (80→8080, 443→8443) |
| `onelake-middleware/` | Backend API หลัก (Node.js :3005) — ต่อ Fabric OneLake / SQL Server / GraphQL |
| `log-receiver/` | Node.js รับ HTTP Log จาก Kong แล้ว batch insert ลงตาราง `kong_api_logs` ทุก 5 วิ |
| `scripts/` | สคริปต์ ops ทั้งหมด — setup Kong, sync routes จาก Swagger, NSG, renew SSL, load test |
| `monitoring/` | Prometheus scrape config + Grafana dashboards (auto-provision จากไฟล์ .json) |
| `init-db/` · `konga-seed/` | SQL สร้างตาราง log ตอน first start · seed user/connection ของ Konga (`userdb.data` gitignored — มีรหัส) |

## คำสั่งที่ใช้จริง

```bash
docker compose up -d                                    # start/อัปเดตทั้งระบบตาม compose
docker compose ps && docker compose logs --tail 50 kong # เช็คสถานะ / ดู log
bash scripts/setup-kong.sh                              # ตั้ง services/routes/plugins ครั้งแรก
./scripts/setup-jwt-metrics.ps1 [-SkipJwtPlugin]        # (Windows) ตั้ง JWT consumer + Prometheus plugin
python3 scripts/sync-routes-from-swagger.py --dry-run   # sync Kong routes จาก Swagger — ดูก่อนเสมอ แล้วค่อยรันจริง
python3 scripts/add-mobile-catchall.py                  # route /uat/* /prod/* ของแอปมือถือ
bash scripts/load-test.sh <server-ip> <jwt-token>       # ทดสอบ load
```

- แก้ route/plugin ของ Kong **ไม่ใช่การ deploy** — ทำผ่าน Admin API (:8001) / Konga (:1337) / สคริปต์ มีผลทันที ไม่ต้อง restart
- route ที่สคริปต์สร้างติด tag (`swagger-sync` / `mobile-env`) — สคริปต์ลบเฉพาะ tag ตัวเอง route ที่เพิ่มมือใน Konga ไม่ถูกแตะ

## Deploy ขึ้น Azure VM

ขั้นตอนเต็มอยู่ `DEPLOY.md` — อ่านก่อนทุกครั้ง สรุปหลักการ (รันจาก PowerShell เครื่องแอดมิน):

```powershell
# 1. ส่งไฟล์: scp ไปพักที่ home ก่อน แล้ว sudo -n mv เข้า /home/adminwebapp/kong/ (ไฟล์ในนั้นเป็นของ root — scp ตรงโดน Permission denied)
scp -i "$env:USERPROFILE\.ssh\kong_vm" <ไฟล์> adminwebapp@20.6.32.81:/home/adminwebapp/
ssh -i "$env:USERPROFILE\.ssh\kong_vm" adminwebapp@20.6.32.81 "sudo -n mv /home/adminwebapp/<ไฟล์> /home/adminwebapp/kong/<ปลายทาง>"
# 2. Apply: sudo -n docker compose up -d <service>   (แก้โค้ด middleware/log-receiver → เพิ่ม --build)
# 3. เช็ค: Test-NetConnection bevprogateway.southeastasia.cloudapp.azure.com -Port 443
```

- docker บน VM ต้องมี `sudo -n` เสมอ · deploy โค้ดใหม่ให้เก็บ `.bak` ตัวเก่าไว้สลับกลับ (ดู `DEPLOY.md` ข้อ 3)
- ต่อ VM ไม่ได้ → เช็ค IP ตัวเองก่อน (ifconfig.me) — NSG (Network Security Group) อนุญาตเฉพาะ IP ออฟฟิศ เปลี่ยน WiFi = โดนบล็อกทุกพอร์ตแอดมิน วิธีเพิ่ม IP อยู่ `USAGE.md`
- SSL ต่ออายุอัตโนมัติผ่าน cron `scripts/renew-ssl.sh` (route `/.well-known/acme-challenge` ใน Kong คือขาต่ออายุ)

## ข้อห้าม / กับดักที่เจอมาแล้วจริง

- **ห้าม `docker compose down -v` เด็ดขาด** — `-v` ลบ volume = config + log ของ gateway หายถาวร (กฎเหล็กใน `DEPLOY.md`)
- **ห้ามเก็บ JWT ทั้งใบลง log** — BEVProAPI ใส่รหัสผ่านผู้ใช้ไว้ใน claim `email` ดึงเฉพาะ `sub` เท่านั้น (`USAGE.md`)
- **ห้ามถอด redaction ของ `request_body`** ใน `scripts/add-jwt-user-plugin.sh` — body `/Authen/token` = username+password จริง · body เก็บเฉพาะ JSON/form ≤ 4 KB และถูกล้างเมื่อเกิน 30 วันโดย cron `scripts/purge-log-bodies.sh` ห้ามปิด cron นี้ (PII + disk)
- **ห้ามลบ route `acme-challenge`** — ลบแล้วต่ออายุ SSL ไม่ได้ ใบรับรองหมด = https ทั้งระบบล่ม
- **ห้ามชี้ Konga ไป PostgreSQL 12+** — sails-postgresql เก่าใช้คอลัมน์ `pg_attrdef.adsrc` ที่ถูกถอดแล้ว crash ตอน start (จึงใช้ sails-disk + volume `konga_data`)
- **ห้าม commit secret** — `.env` (root และ `onelake-middleware/`) กับ `konga-seed/userdb.data` ถูก gitignore ไว้แล้ว เขียนในเอกสารได้แค่ชื่อ key (`GRAFANA_ADMIN_PASSWORD`, `KONGA_ADMIN_PASSWORD`, `JWT_SECRET`)
- `JWT_SECRET` อยู่ 2 ที่: `.env` ของ middleware และตาราง `jwt_secrets` ใน Postgres ของ Kong — rotate ต้องแก้ทั้งคู่ ไม่งั้น token ไม่ผ่านชั้นใดชั้นหนึ่ง
- `GF_SECURITY_ADMIN_PASSWORD` มีผลเฉพาะสร้าง Grafana **ครั้งแรก** — แก้ทีหลังต้องใช้ `grafana cli admin reset-admin-password` (ดู `USAGE.md`)
- แก้ `docker-compose.yml` แล้วต้องดูว่า `docker-compose.override.vm.yml` (และสำเนาบน VM) กับ `docker-compose.nas.yml` ต้องตามไปแก้ไหม — ค่า RAM limit ของ VM ต่างจากไฟล์หลัก
- port 8001 (Admin API) และ 3005 (middleware ตรง) ต้องไม่เปิดจากภายนอก — เข้าผ่าน NSG-allowlist / Kong เท่านั้น
- อย่าพึ่ง ufw บน VM — Docker เขียน iptables ทับเอง ใช้ NSG (`scripts/setup-nsg.sh`) เป็นหลัก

## แก้อะไร ต้องอัปเดตเอกสารตรงไหน (traceability)

PR ที่แก้ config/สคริปต์โดยไม่แก้เอกสารที่ผูกกัน ถือว่ายังไม่เสร็จ (ตามข้อ 8 ของ `docs/ST-documentation-standard.md`)

| แก้อะไร | ต้องอัปเดตด้วย |
|---|---|
| เพิ่ม/แก้ route, service, plugin ใน Kong | ตาราง Routing Map ใน `README.md` + ตาราง Service/Route ใน `USAGE.md` |
| แก้ `docker-compose.yml` | ตามไปดู `docker-compose.override.vm.yml` + สำเนาบน VM + `docker-compose.nas.yml` + ตาราง service ใน `DEPLOY.md` |
| เพิ่ม config key / env | `README.md` + `onelake-middleware/.env.example` |
| แก้ schema ตาราง `kong_api_logs` | `init-db/001-create-logs-table.sql` + ตารางคอลัมน์ log ใน `USAGE.md` + โค้ด `log-receiver/server.js` |
| เพิ่ม/ลบ IP แอดมิน หรือแก้กฎ NSG | รายชื่อ IP ใน `USAGE.md` และ `DEPLOY.md` (กฎเหล็กข้อ 3) |
| แก้ขั้นตอน deploy / เพิ่ม service ใหม่บน VM | `DEPLOY.md` |
| ตัดสินใจเชิงสถาปัตยกรรม | `AD-*` ฉบับใหม่ใน `docs/` — ไม่แก้ทับฉบับเก่า ฉบับเก่ามาร์ค superseded |

## แผนที่เอกสาร

| ไฟล์ | เรื่อง |
|---|---|
| `README.md` | สถาปัตยกรรม · โครงโปรเจกต์ · setup ครั้งแรก · routing map · JWT flow · monitoring |
| `DEPLOY.md` | วิธี deploy ขึ้น Azure VM (scp + sudo -n mv + compose up) + กฎเหล็ก 3 ข้อ |
| `USAGE.md` | Base URL รายแอป · ตาราง service/route จริง · รหัสผ่านอยู่ไหน · งานประจำแอดมิน (NSG, reset รหัส) |
| `docs/ST-documentation-standard.md` | มาตรฐานชื่อไฟล์/โครงเอกสารของทีม |
| `scripts/*.py` `*.sh` `*.ps1` | ops จริง — หัวไฟล์ทุกตัวมีคอมเมนต์อธิบายวิธีใช้ อ่านหัวไฟล์ก่อนรันเสมอ |

หมายเหตุ: `DEPLOY.md` / `USAGE.md` เป็นเอกสารเดิมก่อนมาตรฐาน ST — แตะเนื้อหาครั้งใหญ่เมื่อไหร่ให้ย้ายเข้า `docs/`
พร้อม rename เป็น prefix ตามมาตรฐาน (เช่น `RB-deploy-azure-vm.md`, `RB-gateway-admin.md`) แล้วแก้ link ให้ครบ
