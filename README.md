# Kong API Gateway + OneLake Middleware — Self-hosted Infrastructure

ระบบ Kong API Gateway สำหรับเซิร์ฟเวอร์ส่วนตัว (4 Cores / 16 GB RAM)  
รองรับพนักงาน 400 คน พร้อม Async Log Pipeline, Dashboard, และ **OneLake Middleware** เป็น Backend หลัก

## 🏗️ สถาปัตยกรรมระบบ

```
📱 Mobile App (400 users)  ──┐
🌐 Web Dashboard            ──┤──→  🚪 Kong Gateway (Port 80/443)
🤖 Sync Jobs / Cron          ──┘         │
                                         ├── CORS Plugin
                                         ├── Rate Limiting Plugin (200/min)
                                         ├── HTTP Log Plugin (Async)
                                         │
                                         ├── /api/*        →  🖥️ OneLake Middleware (3005)
                                         ├── /api/sync/*   →  🖥️ OneLake Middleware (3005) [10/min]
                                         ├── /api-docs     →  🖥️ OneLake Middleware (3005)
                                         ├── /v1/main/*    →  🖥️ Main C# API (5000)
                                         └── /v1/safety/*  →  🖥️ Safety Node.js API (5174)
                                         
                               HTTP Log Plugin (Async) → 🔌 Log Receiver (3001)
                                                              ↓ Batch Insert ทุก 5 วินาที
                                                         🐘 PostgreSQL (kong_api_logs)

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
├── scripts/
│   ├── setup-kong.sh               # ตั้งค่า Services/Routes/Plugins
│   ├── load-test.sh                # ทดสอบ High Concurrency
│   └── copy-middleware.sh          # Copy source จาก Middleware project
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

### ขั้นตอนที่ 4: เข้า Dashboard

| Service | URL | หมายเหตุ |
|---------|-----|----------|
| Kong Proxy | `http://localhost:80` | API Gateway endpoint |
| Kong Admin | `http://localhost:8001` | Admin API (ปิด Firewall!) |
| Kong Manager | `http://localhost:8002` | Built-in UI |
| Konga | `http://localhost:1337` | Community Dashboard |
| Swagger Docs | `http://localhost/api-docs` | OneLake Middleware API Docs |
| Log Receiver | `http://localhost:3001/health` | Health check + stats |

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

| Path | Upstream Service | Rate Limit | หมายเหตุ |
|------|-----------------|------------|----------|
| `/api/*` | OneLake Middleware (:3005) | 200/min | JWT protected API endpoints |
| `/api/sync/*` | OneLake Middleware (:3005) | **10/min** | Sync data (เข้มขึ้น) |
| `/api-docs` | OneLake Middleware (:3005) | 200/min | Swagger UI (public) |
| `/health` | OneLake Middleware (:3005) | 200/min | Health check |
| `/v1/main/*` | Main C# API (:5000) | 200/min | ใบงานหลัก |
| `/v1/safety/*` | Safety API (:5174) | 200/min | Safety system |

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

## 🔒 ข้อควรระวังด้าน Security

- **ปิด Port 8001** จากภายนอกด้วย Firewall (Admin API)
- **ปิด Port 3005** จากภายนอก — เข้าผ่าน Kong เท่านั้น
- เปลี่ยน `TOKEN_SECRET` ของ Konga
- เปลี่ยนรหัสผ่าน PostgreSQL จาก default
- เปิด SSL/TLS สำหรับ production
- ตรวจสอบ `.env` ของ Middleware ไม่มี commit ขึ้น Git
