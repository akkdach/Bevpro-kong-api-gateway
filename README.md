# Kong API Gateway + OneLake Middleware — Self-hosted Infrastructure

ระบบ Kong API Gateway สำหรับเซิร์ฟเวอร์ส่วนตัว (4 Cores / 16 GB RAM)  
รองรับพนักงาน 400 คน พร้อม Async Log Pipeline, Dashboard, และ **OneLake Middleware** เป็น Backend หลัก

## 🏗️ สถาปัตยกรรมระบบ

```
📱 Mobile App (400 users)  ──┐   (แนบ Authorization: Bearer <JWT_Token>)
🌐 Web Dashboard            ──┤──→  🚪 Kong Gateway (Port 80/443)
🤖 Sync Jobs / Cron          ──┘         │
                                         ├── JWT Plugin (เฉพาะ /api/*) — ดึง 'iss' จาก JWT มาเป็น Consumer
                                         ├── Rate Limiting Plugin (200/min, limit_by=consumer)
                                         ├── Prometheus Plugin — พ่น Metrics ราย Consumer ที่ :8100/metrics
                                         ├── CORS Plugin
                                         ├── HTTP Log Plugin (Async)
                                         │
                                         ├── /api/*             →  🖥️ OneLake Middleware (3005) [JWT]
                                         ├── /api/auth/login    →  🖥️ OneLake Middleware (3005) [public — ขอ token]
                                         ├── /api/request-status→  🖥️ OneLake Middleware (3005) [Basic auth ที่แอป]
                                         ├── /api/sync/*        →  🖥️ OneLake Middleware (3005) [10/min, Basic auth ที่แอป]
                                         ├── /api-docs          →  🖥️ OneLake Middleware (3005)
                                         ├── /v1/main/*         →  🖥️ Main C# API (5000)
                                         └── /v1/safety/*       →  🖥️ Safety Node.js API (5174)

                               HTTP Log Plugin (Async) → 🔌 Log Receiver (3001)
                                                              ↓ Batch Insert ทุก 5 วินาที
                                                         🐘 PostgreSQL (kong_api_logs)

                               Prometheus Plugin (:8100/metrics)
                                         │ (Scrape ทุก ๆ 15 วินาที)
                                         ▼
                               📈 Prometheus Server (9090) — Time-Series Data
                                         │
                                         ▼
                               📊 Grafana Dashboard (3000) — สถิติ + กราฟเรียลไทม์

👤 Admin → 📊 Konga (1337) / Kong Manager (8002)
               ↓
          Kong Admin API (8001)
```

## 📁 โครงสร้างโปรเจค

```
kong-api-gateway/
├── docker-compose.yml              # Docker Compose หลัก (Kong + Middleware + Log)
├── init-db/
│   └── 001-create-logs-table.sql   # สร้างตาราง kong_api_logs อัตโนมัติ
├── log-receiver/
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js                   # ตัวรับ Log + Batch Insert
│   └── .dockerignore
├── onelake-middleware/              # ← OneLake Middleware source code
│   ├── Dockerfile
│   ├── .env                        # Environment variables (ค่าจริง)
│   ├── .env.example                # Template ตัวอย่าง
│   ├── server.js
│   ├── package.json
│   └── src/                        # Controllers, Routes, Services, etc.
├── monitoring/
│   ├── prometheus/
│   │   └── prometheus.yml          # Scrape config (Kong :8100 ทุก 15s)
│   └── grafana/
│       ├── provisioning/           # Datasource + dashboard provider (auto-load)
│       └── dashboards/
│           ├── kong-official.json  # Dashboard ทางการของ Kong (id 7424)
│           └── kong-consumers.json # Dashboard ราย Consumer (429, req/s, bandwidth)
├── scripts/
│   ├── setup-kong.sh               # ตั้งค่า Services/Routes/Plugins (bash)
│   ├── setup-jwt-metrics.ps1       # ตั้งค่า JWT Consumer + Prometheus (Windows)
│   ├── load-test.sh                # ทดสอบ High Concurrency
│   └── copy-middleware.sh          # Copy source จาก Middleware project
├── .env                            # GRAFANA_ADMIN_PASSWORD (gitignored)
└── README.md
```

## 🚀 วิธีใช้งาน

### ขั้นตอนที่ 1: เตรียม OneLake Middleware

```bash
# วิธี A: Copy source code มาไว้ใน project
bash scripts/copy-middleware.sh /path/to/onelake-middleware/onelake-middleware

# วิธี B: Copy manual
cp -r /path/to/onelake-middleware/onelake-middleware ./onelake-middleware/
```

ตรวจสอบว่าไฟล์ `./onelake-middleware/.env` มีค่า config ครบ (ดูตัวอย่างจาก `.env.example`)

### ขั้นตอนที่ 2: เริ่มระบบทั้งหมด

```bash
docker compose up -d
```

> ⏳ ครั้งแรกจะใช้เวลา ~3-5 นาที (pull images + build middleware + run migrations)

ตรวจสอบสถานะ:
```bash
docker compose ps        # ดู container ทั้งหมด
docker compose logs kong  # ดู log ของ Kong
docker compose logs onelake-middleware  # ดู log ของ Middleware
```

### ขั้นตอนที่ 3: ตั้งค่า Kong (Services, Routes, Plugins)

```bash
chmod +x scripts/setup-kong.sh
bash scripts/setup-kong.sh
```

บน Windows (ตั้งค่าส่วน JWT Consumer + Prometheus):
```powershell
.\scripts\setup-jwt-metrics.ps1                  # ตั้งค่าทั้งหมดรวมเปิดบังคับ JWT
.\scripts\setup-jwt-metrics.ps1 -SkipJwtPlugin   # ตั้งค่าโดยยังไม่บังคับ JWT
```

### ขั้นตอนที่ 4: เข้า Dashboard

| Service | URL | หมายเหตุ |
|---------|-----|----------|
| Kong Proxy | `http://localhost:80` | API Gateway endpoint |
| Kong Admin | `http://localhost:8001` | Admin API (ปิด Firewall!) |
| Kong Manager | `http://localhost:8002` | Built-in UI |
| Konga | `http://localhost:1337` | user `admin` / รหัสใน `.env` (`KONGA_ADMIN_PASSWORD`) — connection ถูก seed ให้แล้ว |
| Swagger Docs | `http://localhost/api-docs` | OneLake Middleware API Docs |
| Log Receiver | `http://localhost:3001/health` | Health check + stats |
| Prometheus | `http://localhost:9090` | Time-series metrics (targets: /targets) |
| Grafana | `http://localhost:3000` | user `admin` / รหัสใน `.env` (`GRAFANA_ADMIN_PASSWORD`) |
| Kong Metrics | `http://localhost:8100/metrics` | Status listener (bind เฉพาะ localhost) |

### ขั้นตอนที่ 5: ทดสอบ

```bash
# ทดสอบ Health Check ผ่าน Kong
curl http://localhost/health

# ทดสอบ API ผ่าน Kong (ต้องมี JWT token)
curl -H "Authorization: Bearer <token>" http://localhost/api/orders

# ดู Swagger Docs
open http://localhost/api-docs

# ทดสอบ Load
chmod +x scripts/load-test.sh
bash scripts/load-test.sh <server-ip> <jwt-token>
```

## 🔀 Routing Map — เส้นทางผ่าน Kong

| Path | Upstream Service | Rate Limit | Auth |
|------|-----------------|------------|------|
| `/api/*` | OneLake Middleware (:3005) | 200/min ราย Consumer | **JWT (Kong)** + validateJwt (แอป) |
| `/api/auth/login` | OneLake Middleware (:3005) | 200/min | Public — แลก Entra token เป็น JWT |
| `/api/request-status/*` | OneLake Middleware (:3005) | 200/min | Basic auth (ที่แอป) |
| `/api/sync/*` | OneLake Middleware (:3005) | **10/min** | Basic auth (ที่แอป) |
| `/api-docs` | OneLake Middleware (:3005) | 200/min | Public — Swagger UI |
| `/health` | OneLake Middleware (:3005) | 200/min | Public |
| `/v1/main/*` | Main C# API (:5000) | 200/min | — |
| `/v1/safety/*` | Safety API (:5174) | 200/min | — |

## 🔐 JWT Flow — Kong Consumer ราย App

1. Client login ที่ `POST /api/auth/login` ด้วย Entra ID token → Middleware ตรวจกับ Microsoft แล้วออก **internal JWT** (HS256, อายุ 24 ชม.) พร้อม claim `iss` = `JWT_ISSUER` (ค่าเริ่มต้น `onelake-app`) และ `sub` = email
2. Client แนบ `Authorization: Bearer <token>` เรียก `/api/*`
3. **JWT plugin ของ Kong** ตรวจลายเซ็น + `exp` แล้วจับคู่ `iss` กับ jwt credential ของ Consumer → นับ rate limit แยกราย Consumer และส่ง header `X-Consumer-Username` ให้ upstream
4. Middleware ตรวจ token ซ้ำอีกชั้นด้วย `validateJwt` (defense-in-depth)
5. Prometheus plugin ติด label `consumer` ใน metrics → ดูราย Consumer ได้ใน Grafana

### เพิ่มแอป/Consumer ใหม่

```bash
# 1. สร้าง Consumer
curl -X PUT http://localhost:8001/consumers/new-app --data "custom_id=new-app"

# 2. สร้าง JWT credential (แนะนำ: ใช้ secret แยกของแอปใหม่ ไม่ใช้ secret ร่วม)
curl -X POST http://localhost:8001/consumers/new-app/jwt \
  --data "key=new-app" --data "algorithm=HS256" --data-urlencode "secret=<NEW_APP_SECRET>"

# 3. แอปใหม่ sign token ด้วย secret ของตัวเอง + iss=new-app
```

### ปิด JWT plugin ชั่วคราว (rollback)

```powershell
$p = (curl.exe -s http://localhost:8001/routes/middleware-api-route/plugins | ConvertFrom-Json).data | Where-Object { $_.name -eq "jwt" }
curl.exe -s -X PATCH "http://localhost:8001/plugins/$($p.id)" --data "enabled=false"   # เปิดกลับ: enabled=true
```

## 📈 Monitoring — Prometheus + Grafana

- Kong พ่น metrics ที่ status listener `:8100/metrics` (เปิด `per_consumer=true`)
- Prometheus (`:9090`) scrape ทุก 15 วินาที เก็บย้อนหลัง 30 วัน
- Grafana (`:3000`, บน VM เข้าผ่าน `https://<gateway>/grafana`) auto-provision dashboards จาก `monitoring/grafana/dashboards/*.json` ในโฟลเดอร์ "Kong" (reload เองทุก 30 วิ):
  - **Kong (official)** — ภาพรวม request rate, latency, bandwidth (Prometheus)
  - **Kong — Per-Consumer Overview** — req/s, 429, bandwidth แยกราย Consumer (Prometheus)
  - **Kong — Traffic & Logs** — metrics สด + log ล่าสุดจากตาราง `kong_api_logs`
  - **Kong — Deep Analysis** — ภาพรวม/การใช้งาน/ความเร็ว/error/โควตาเน็ต/rate limit (จาก log)
  - **Kong — ปริมาณข้อมูลราย endpoint / รายพนักงาน** (`kong-upload-drill`) — เลือก endpoint แล้วดู upload/download รายพนักงาน
  - **Kong — ใครยิงอะไร** (`kong-who-calls-what`) — dropdown IP · ชนิดแอป · user · endpoint กรองทุก panel + log ดิบ (ใช้ตอบ "เครื่องไหนยิงเส้นไหน")
- dashboard ที่อ่านจาก log ใช้ datasource Postgres uid `konglogs` · `request_body` ไม่ได้เก็บ (log-receiver ตั้ง null)
- ข้อจำกัด OSS: label `consumer` มีเฉพาะ request count + bandwidth (latency ได้ละเอียดสุดราย service/route)

## ⚙️ การปรับแต่ง

### เปลี่ยน Upstream API URL
แก้ไขใน `scripts/setup-kong.sh`:
```bash
# เปลี่ยน URL ของ Main API
--data "url=http://your-csharp-api:5000"

# เปลี่ยน URL ของ Safety API
--data "url=http://your-nodejs-api:5174"
```

### เปลี่ยนรหัสผ่าน PostgreSQL
แก้ไขใน `docker-compose.yml` ทุกที่ที่มี `kong_secure_password`

### เปิด Port 3005 สำหรับ Debug
ถ้าต้องการเข้า Middleware ตรงโดยไม่ผ่าน Kong (เช่น debug):
```yaml
# ใน docker-compose.yml → onelake-middleware
ports:
  - "3005:3005"
```

## 🎛️ Konga — หมายเหตุการติดตั้ง

- Konga รันโหมด production ซึ่ง**ปิดหน้า register** — บัญชี admin ถูกสร้างผ่าน seed file `konga-seed/userdb.data` (gitignored เพราะมีรหัสผ่าน) และ connection เข้า Kong ถูก seed จาก `konga-seed/kongnode.data`
- ข้อมูลของ Konga (users, connections, snapshots) เก็บใน volume `konga_data` (`/app/kongadata/konga.db`) — รอดการ recreate container
- **ห้ามชี้ Konga ไปใช้ PostgreSQL 12+** — sails-postgresql เวอร์ชันเก่าใน Konga ใช้คอลัมน์ `pg_attrdef.adsrc` ที่ถูกถอดออกแล้ว จะ crash ตอน start (จึงใช้ sails-disk + volume แทน)
- fresh install: แค่มีไฟล์ seed ทั้งสองอยู่ครบ `docker compose up -d konga` ก็พร้อมใช้ทันที

## 🔒 ข้อควรระวังด้าน Security

- **บน Azure VM**: ตั้ง NSG ด้วย `RG=<rg> VM_NAME=<vm> ADMIN_IP=<ip>/32 bash scripts/setup-nsg.sh`
  (รันจาก Cloud Shell หรือเครื่องที่ `az login` แล้ว) — อย่าพึ่ง ufw บน VM เพราะ Docker เขียน iptables ทับเอง
- **ปิด Port 8001** จากภายนอกด้วย Firewall (Admin API)
- **ปิด Port 3005** จากภายนอก — เข้าผ่าน Kong เท่านั้น
- Port 8100 (metrics) bind ที่ `127.0.0.1` แล้ว — Prometheus ใช้ Docker network ภายใน
- `JWT_SECRET` ถูกเก็บ 2 ที่: `.env` ของ Middleware และตาราง `jwt_secrets` ใน Postgres ของ Kong — ถ้า rotate ต้องแก้ทั้งคู่ (`.env` + `PATCH /consumers/onelake-app/jwt/<id>`)
- เปลี่ยน `GRAFANA_ADMIN_PASSWORD` ใน `.env` root และ `TOKEN_SECRET` ของ Konga
- เปลี่ยนรหัสผ่าน PostgreSQL จาก default
- เปิด SSL/TLS สำหรับ production
- ตรวจสอบ `.env` ของ Middleware ไม่มี commit ขึ้น Git
