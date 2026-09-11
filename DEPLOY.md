# คู่มือ Deploy — Kong Gateway บน Azure VM

> สำหรับ: ผู้ใช้ + AI ทุก session (อัปเดต 2026-08-03)
> VM: `WebApplication-kong-gateway` (20.6.32.81) · user `adminwebapp` · กุญแจ `%USERPROFILE%\.ssh\kong_vm`
> ทุกคำสั่งรันใน **PowerShell** บนเครื่องแอดมิน · docker บน VM ต้องมี `sudo -n` เสมอ

---

## ⚠️ กฎเหล็ก 3 ข้อ (อ่านก่อนทุกครั้ง)

1. **ห้ามใช้ `docker compose down -v` เด็ดขาด** — `-v` ลบ volume = log + config ของ gateway หายถาวรทั้งหมด
2. ไฟล์ใน `/home/adminwebapp/kong/` ส่วนใหญ่เป็นของ root — **scp ตรงเข้าไปจะโดน Permission denied** ให้ scp ไปวางที่ home ก่อนแล้ว `sudo -n mv` เข้าที่ (ดูข้อ 1 ด้านล่าง)
3. ถ้าคำสั่งไม่ติดแต่ต่อ VM ไม่ได้เลย → เช็ค IP ตัวเองก่อน (`ifconfig.me`) — IP ออฟฟิศที่ NSG อนุญาต: `171.103.89.247` และ `87.124.104.34` เปลี่ยน WiFi แล้ว IP หลุดรายชื่อ = โดนบล็อกทุกพอร์ตแอดมิน

---

## 1. ส่งไฟล์ config ขึ้น VM (แบบมาตรฐาน — ใช้ได้กับทุกไฟล์)

```powershell
# ขั้น 1: ส่งไปพักที่ home (เปลี่ยนชื่อไฟล์ตามจริง)
scp -i "$env:USERPROFILE\.ssh\kong_vm" "C:\path\ไฟล์ในเครื่อง" adminwebapp@20.6.32.81:/home/adminwebapp/

# ขั้น 2: ย้ายเข้าที่ด้วยสิทธิ์ root (แก้ path ปลายทางตามจริง)
ssh -i "$env:USERPROFILE\.ssh\kong_vm" adminwebapp@20.6.32.81 "sudo -n mv /home/adminwebapp/ชื่อไฟล์ /home/adminwebapp/kong/ปลายทาง"
```

ตัวอย่างจริงที่ใช้บ่อย:

| ไฟล์ในโปรเจกต์ | ปลายทางบน VM |
|---|---|
| `docker-compose.override.vm.yml` | `/home/adminwebapp/kong/docker-compose.override.yml` (ชื่อเปลี่ยน!) |
| `monitoring/grafana/dashboards/*.json` | `/home/adminwebapp/kong/monitoring/grafana/dashboards/` (Grafana โหลดเองใน 30 วิ) |

## 2. Apply การเปลี่ยนแปลง (หลังส่งไฟล์)

```powershell
# service เดียว (เร็ว ปลอดภัยสุด — ระบุชื่อ เช่น pg-bridge, grafana, kong)
ssh -i "$env:USERPROFILE\.ssh\kong_vm" adminwebapp@20.6.32.81 "cd /home/adminwebapp/kong && sudo -n docker compose up -d ชื่อservice"

# ทั้งระบบ (compose เทียบเองว่าตัวไหนต้องสร้างใหม่ ตัวอื่นไม่แตะ)
ssh -i "$env:USERPROFILE\.ssh\kong_vm" adminwebapp@20.6.32.81 "cd /home/adminwebapp/kong && sudo -n docker compose up -d"
```

## 3. Deploy โค้ดใหม่ (build image ใหม่ — onelake-middleware / log-receiver)

```powershell
# ส่งโฟลเดอร์โค้ดขึ้นไปก่อน (ตัวอย่าง: log-receiver)
scp -r -i "$env:USERPROFILE\.ssh\kong_vm" "C:\Users\Ronnachai.Pr\.gemini\antigravity\scratch\kong-api-gateway\log-receiver" adminwebapp@20.6.32.81:/home/adminwebapp/staging-upload

# ย้ายเข้าที่ + build + start
ssh -i "$env:USERPROFILE\.ssh\kong_vm" adminwebapp@20.6.32.81 "sudo -n rm -rf /home/adminwebapp/kong/log-receiver.bak && sudo -n mv /home/adminwebapp/kong/log-receiver /home/adminwebapp/kong/log-receiver.bak && sudo -n mv /home/adminwebapp/staging-upload /home/adminwebapp/kong/log-receiver && cd /home/adminwebapp/kong && sudo -n docker compose up -d --build log-receiver"
```

(มี `.bak` ตัวเก่าเก็บไว้เสมอ — พังค่อยสลับกลับ)

## 4. Restart เฉยๆ (ไม่มีไฟล์ใหม่)

```powershell
ssh -i "$env:USERPROFILE\.ssh\kong_vm" adminwebapp@20.6.32.81 "cd /home/adminwebapp/kong && sudo -n docker compose restart ชื่อservice"
```

## 5. เช็คสถานะ + ดู log เวลามีปัญหา

```powershell
# container ไหนรันอยู่ เปิดพอร์ตอะไร
ssh -i "$env:USERPROFILE\.ssh\kong_vm" adminwebapp@20.6.32.81 "sudo -n docker ps --format '{{.Names}} -> {{.Status}} | {{.Ports}}'"

# log 50 บรรทัดล่าสุดของ service (เปลี่ยนชื่อตามต้องการ)
ssh -i "$env:USERPROFILE\.ssh\kong_vm" adminwebapp@20.6.32.81 "cd /home/adminwebapp/kong && sudo -n docker compose logs --tail 50 ชื่อservice"
```

## 6. เช็คหลัง deploy ทุกครั้ง (จากเครื่องแอดมิน)

```powershell
# gateway ยังตอบไหม
Test-NetConnection bevprogateway.southeastasia.cloudapp.azure.com -Port 443

# pgAdmin ยังต่อได้ไหม
Test-NetConnection 20.6.32.81 -Port 5432
```

---

## รายชื่อ service ในระบบ

| ชื่อ | คืออะไร | Deploy บ่อยไหม |
|---|---|---|
| `kong` | ตัว gateway หลัก | นานๆ ครั้ง (อัปเกรดเวอร์ชัน) |
| `kong-database` | Postgres เก็บ config + log | ❌ อย่าแตะถ้าไม่จำเป็น |
| `pg-bridge` | ประตูให้ pgAdmin ต่อพอร์ต 5432 | ตามไฟล์ override |
| `log-receiver` | รับ log จาก Kong ลง Postgres | เมื่อแก้โค้ด |
| `onelake-middleware` | Backend API (OneLake/SQL) | เมื่อแก้โค้ด |
| `grafana` / `prometheus` | Dashboard + เก็บ metrics | dashboard = แค่วางไฟล์ .json ไม่ต้อง restart |
| `konga` | หน้า admin ของ Kong | แทบไม่เคย |

> หมายเหตุ: การแก้ route/plugin ของ Kong **ไม่ใช่การ deploy** — ทำผ่าน Admin API (พอร์ต 8001) หรือ Konga ได้ทันที ไม่ต้อง restart อะไร

---

## 7. ติดตั้ง datasource SQL Server + ตัวเก็บสถานะ lock (ทำครั้งเดียว)

ใช้กับ dashboard `sqlserver-lock-live` และ `sqlserver-lock-history` ซึ่งอ่าน DMV ของ SQL Server ที่ VM `WebApplication` (10.0.0.4) โดยตรง ไม่ผ่าน Kong

**ลำดับสำคัญ ทำผิดลำดับแล้วจะต่อไม่ติด**

1. **สร้าง login read-only บน SQL Server** เปิด SSMS ต่อไปที่ instance `WebApplication\MSSQLQAS` ด้วยบัญชี sysadmin แล้วรัน `scripts/create-grafana-sql-login.sql` (แก้รหัสในไฟล์ก่อนรัน) — ⚠️ ห้ามใช้ `sa`
2. **ใส่รหัสใน `.env` ของ Kong VM** เพิ่มบรรทัด `MSSQL_GRAFANA_PASSWORD=<รหัสที่ตั้งไว้>` ใน `/home/adminwebapp/kong/.env` (ไฟล์นี้ gitignored อยู่แล้ว)
3. **ส่งไฟล์ขึ้น VM** ตามขั้นตอนข้อ 1 ของคู่มือนี้ — `monitoring/grafana/provisioning/datasources/mssql.yml`, `monitoring/grafana/dashboards/*.json`, `scripts/sample-sqlserver-locks.sh`, `scripts/install-lock-sampler.sh`, `init-db/002-create-lock-sample-tables.sql` และ `docker-compose.override.vm.yml` (ปลายทางชื่อ `docker-compose.override.yml`)
4. **สร้าง grafana ใหม่ให้รับ env** `sudo -n docker compose up -d grafana` — env ใหม่ 4 ตัวอยู่ใน override ไม่ต้องแตะ `docker-compose.yml` บน VM
5. **ติดตั้งตัวเก็บตัวอย่าง** `sudo bash /home/adminwebapp/kong/scripts/install-lock-sampler.sh` — สร้างตาราง ดึง image sqlcmd ทดสอบการเชื่อมต่อ และใส่ cron ทุก 1 นาที รันซ้ำได้ไม่มีผลข้างเคียง

**ตรวจว่าใช้ได้จริง**
```bash
# ตัวเก็บตัวอย่างเขียนข้อมูลเข้าแล้วหรือยัง (รอ 2 นาทีหลังติดตั้ง)
sudo -n docker exec kong-database psql -U kong -d kong -c "SELECT max(sampled_at) FROM sql_index_usage_samples;"

# ถ้าว่าง ให้ดูสาเหตุที่ log
tail -20 /var/log/kong-lock-sampler.log
```

> ถ้ายังไม่ได้ทำขั้นที่ 1 กับ 2 ทุกอย่างยังติดตั้งได้ตามปกติ dashboard `kong-lock-contention` (อ่านจาก log ของ Kong) ใช้งานได้เลย ส่วนอีกสองหน้าจะว่างจนกว่าจะมีรหัส
