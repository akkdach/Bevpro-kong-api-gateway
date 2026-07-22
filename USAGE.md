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
| **Mobile (UAT)** | `EXPO_PUBLIC_API_BASE_URL` | `GW/uat` **หรือ** `GW/uat/api/v1` (ใช้ได้ทั้งคู่) |
| **Mobile (PROD)** | `EXPO_PUBLIC_API_BASE_URL` | `GW/prod` **หรือ** `GW/prod/api/v1` |
| **pro-iot-board** | `REACT_APP_API_BASE_URL_ONE_LEKE` | `GW/api` |
| | `REACT_APP_API_BASE_URL_IOT` | `GW/iot/v1` |
| | `REACT_APP_API_BASE_URL_REVENUE` | `GW/revenue/v1` |
| | `REACT_APP_API_BASE_URL` (BEVProAPI) | เรียกตรง ไม่ผ่าน gateway |
| | `REACT_APP_API_BASE_URL_IMAGE` | เรียกตรง ไม่ผ่าน gateway |

- SSL: Let's Encrypt หมดอายุ 19 ต.ค. 2026 — ต่ออายุอัตโนมัติผ่าน cron (`scripts/renew-ssl.sh` วันละ 2 ครั้ง)
- `http://` ยังใช้ได้ แต่ใช้ `https://` เสมอ ไม่งั้นเว็บที่เปิดด้วย https จะโดน mixed content บล็อก
- `/api/WizardConfig` ชี้ **prod เสมอ** แยก environment ไม่ได้ เพราะแอปตัด path เหลือแค่ host

## 🗺️ Service / Route ใน Kong

| service | upstream | route |
|---|---|---|
| `onelake-middleware` | Azure App Service | 68 เส้น (`/api/*`) sync จาก Swagger |
| `bevpro-uat` | `service.bevproasia.com:5001` | `/uat/*` catch-all + public 6 เส้น |
| `bevpro-prod` | `service.bevproasia.com` | `/prod/*` catch-all + public 6 เส้น + `/api/WizardConfig` |
| `iot-service` | `iotservice.bevproasia.com/api/v1` | `/iot/v1` |
| `revenue-service` | `servicemanagement-...azurewebsites.net/api/v1` | `/revenue/v1` |
| `acme-challenge` | nginx ภายใน | `/.well-known/acme-challenge` (ต่ออายุ SSL — **ห้ามลบ**) |

**consumer:** `BevProApp` (key = `http://www.xxx.com`) · `onelake-app` (สำรอง ยังไม่มีใครใช้)

### สคริปต์จัดการ route

```bash
python3 scripts/sync-routes-from-swagger.py --dry-run   # onelake — ดูก่อน
python3 scripts/sync-routes-from-swagger.py             # onelake — ลงจริง
python3 scripts/add-mobile-catchall.py                  # Mobile uat/prod (แบบ ANY)
python3 scripts/add-mobile-env-routes.py                # Mobile แบบ allowlist รายเส้น (ทางเลือก)
sh      scripts/add-jwt-user-plugin.sh                  # ติดตั้ง pre-function ดึงชื่อผู้ใช้จาก JWT
```

> route ที่สคริปต์สร้างจะติด tag (`swagger-sync` / `mobile-env`) — ตอนลบจะลบเฉพาะที่มี tag ของตัวเอง **route ที่เพิ่มมือใน Konga จึงไม่ถูกแตะ**

## 📊 ข้อมูลที่เก็บใน log (ตาราง `kong_api_logs`)

| คอลัมน์ | ได้มาจาก | ใช้ทำอะไร |
|---|---|---|
| `consumer_username` | Kong JWT plugin | แยกราย **แอป** |
| `jwt_user` | claim `sub` (ผ่าน pre-function) | แยกราย **คน** |
| `device_id` | header `Device_ID` จากแอป | แยกราย **เครื่อง** |
| `client_ip` · `user_agent` | Kong | เครือข่าย / ชนิดแอป |
| `request_size` + `response_size` | Kong | โควตาอินเทอร์เน็ต 20 GB (PROPOSAL 4.2) |
| `route_name` · `latency_ms` · `status_code` | Kong | วินิจฉัยปัญหา |

> ⚠️ **ห้ามเก็บ JWT ทั้งใบ** — BEVProAPI ใส่รหัสผ่านผู้ใช้ไว้ใน claim `email` (`AuthenController.cs`) ดึงเฉพาะ `sub` เท่านั้น

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

**IP แอดมินที่อนุญาตตอนนี้:** `171.103.89.247` และ `87.124.104.34` (เน็ตออฟฟิศมี 2 ขาออก)

## 🔑 ชื่อผู้ใช้ / รหัสผ่านอยู่ที่ไหน

| ระบบ | ชื่อผู้ใช้ | รหัสผ่าน |
|---|---|---|
| Grafana | `admin` | รีเซ็ตใหม่เมื่อ 20 ก.ค. 2026 — ไม่เก็บรหัสไว้ในไฟล์นี้ (ไฟล์นี้ขึ้น git ได้) ลืมแล้วรีเซ็ตใหม่ตามคำสั่งด้านล่าง |
| Konga | `admin` | ดูในไฟล์ `konga-seed/userdb.data` บรรทัด `"password"` |
| Kong Manager / Prometheus | — | ไม่มีระบบล็อกอิน (ปลอดภัยเพราะเปิดเฉพาะ IP แอดมิน) |

ลืมรหัส Grafana → รีเซ็ตทาง SSH (ได้ผลทันที ไม่ต้องรีสตาร์ท):

```bash
docker exec grafana grafana cli --homepath /usr/share/grafana admin reset-admin-password 'รหัสใหม่'
```

> หมายเหตุ: ค่า `GF_SECURITY_ADMIN_PASSWORD` ใน docker-compose มีผลเฉพาะตอนสร้าง Grafana **ครั้งแรก** เท่านั้น
> แก้ค่านั้นทีหลังแล้วรีสตาร์ทจะไม่เปลี่ยนรหัส — ต้องใช้คำสั่ง reset ข้างบน

## 🛠️ งานประจำของแอดมิน

### เพิ่ม IP แอดมินคนใหม่ (รันใน PowerShell เครื่องที่ล็อกอิน Azure CLI ไว้)

> ⚠️ คำสั่งนี้**แทนที่รายการทั้งหมด** — ต้องใส่ IP เดิมทุกตัว + ตัวใหม่ต่อท้ายเสมอ

```powershell
az network nsg rule update -g WebApplication_group --nsg-name WebApplication-kong-gateway-nsg -n Allow-SSH-AdminOnly --source-address-prefixes "171.103.89.247/32" "87.124.104.34/32" "IPใหม่/32"
az network nsg rule update -g WebApplication_group --nsg-name WebApplication-kong-gateway-nsg -n Allow-Admin-Dashboards --source-address-prefixes "171.103.89.247/32" "87.124.104.34/32" "IPใหม่/32"
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
