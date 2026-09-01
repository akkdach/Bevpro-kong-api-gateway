# คู่มือใส่ X-App-Name ให้แอปโผล่แยกรายแอปใน Kong dashboard

วิธีทำให้แอป (เว็บ/มือถือ/backend) ส่ง header `X-App-Name` เมื่อเรียก API ผ่าน Kong gateway
เพื่อให้ dashboard "Kong — ใครยิงอะไร" และ "Deep Analysis → สรุปรายแอป" แยก traffic รายแอปได้
พร้อมบันทึกว่าแต่ละโปรเจกต์ทำไปแล้วอย่างไร (ใช้เป็นตัวอย่าง copy ได้)

| | |
|---|---|
| เวอร์ชันเอกสาร | 2026-09-01 |
| ชั้นเอกสาร | B — Dev แก้ได้ |
| เจ้าของ | DevOps (Ronnachai) |
| ใช้กับ | ทุกแอปที่เรียก API ผ่าน `bevprogateway.southeastasia.cloudapp.azure.com` |

> ทำไมต้องมี: ทุกแอปใช้ JWT ตระกูลเดียวกัน → ฝั่ง Kong เห็น consumer เป็น `BevProApp` เหมือนกันหมด
> แยกไม่ออกว่า traffic มาจากแอปไหน — header `X-App-Name` คือป้ายชื่อที่แต่ละแอปติดมาเอง
> ระบบฝั่ง gateway (คอลัมน์ `app_name` ในตาราง log, CORS whitelist, dashboard) **รองรับครบแล้ว
> ไม่ต้องแตะ Kong อีก** — งานอยู่ฝั่งแอปอย่างเดียว

---

## 1. หลักการ (อ่านก่อนทำ)

1. **แนบ header เฉพาะ request ที่ปลายทางคือ gateway** — host อื่น (backend ตรง, MS Graph, Firebase)
   ไม่ได้ประกาศ header นี้ใน CORS policy ของเขา ถ้าเป็นโค้ดที่รันใน browser แล้วแนบมั่ว
   browser จะ block ทั้ง request (แอปมือถือ/ฝั่ง server ไม่มี CORS แต่ทำเงื่อนไขไว้เหมือนกันจะได้ code เดียวใช้ได้ทุกที่)
2. **ตั้งชื่อแอปตามชื่อ repo จริงบน GitHub** — จะได้ไม่งงใน dashboard (บทเรียน: เคยตั้ง `iot-dashboard`
   ทั้งที่ repo ชื่อ `iot` สุดท้ายต้องเปลี่ยน)
3. **ทำที่ api client กลางจุดเดียว** (axios interceptor / fetch wrapper) — อย่าไล่ใส่ทีละหน้า
4. **token ต้องมี claim `iss`** — Kong jwt plugin ใช้ `iss` หา consumer (`key_claim_name=iss`)
   - token จาก `/Authen/token` ของ BEVProAPI = มี `iss` อยู่แล้ว ✅
   - token ที่แอป **mint เอง** ต้องใส่ `iss`/`aud` (ค่าเดียวกับ `JWT_ISSUER`/`JWT_AUDIENCE` = consumer key ใน Kong)
     ไม่งั้นโดน 401 ทุกเส้นที่ผ่าน gateway — บั๊กจริงที่เจอมาแล้ว 2 ที่:
     `service-management/server/api/routes/auth.routes.ts` (MS/Firebase login) และ
     `bevpro-agentic-app/app/lib/agent/so-tracking-tools/auth.ts`

## 2. โค้ดสูตรสำเร็จ

### 2.1 axios (React/CRA/React Native) — helper กลาง + interceptor

```ts
// src/Services/appName.ts  (copy จาก pro-iot-mobile / pro-iot-board ได้เลย)
export const APP_NAME = '<ชื่อ-repo>';
export const GATEWAY_HOST = 'bevprogateway.southeastasia.cloudapp.azure.com';

export function attachAppName(config: any) {
    try {
        const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
        const url = new URL(config.url ?? '', config.baseURL ?? origin);
        if (url.host === GATEWAY_HOST && config.headers) {
            config.headers['X-App-Name'] = APP_NAME;   // axios v1 ที่ headers เป็น object
            // ถ้า client ใช้ AxiosHeaders: config.headers.set('X-App-Name', APP_NAME)
        }
    } catch { /* URL แปลก ๆ ก็แค่ไม่แนบ */ }
    return config;
}
```

ใน request interceptor ของ **ทุก** axios client เปลี่ยนบรรทัดสุดท้ายจาก `return config;` เป็น:

```ts
return attachAppName(config);
```

### 2.2 fetch (Remix/Next server-side) — แนบตรงในจุด fetch

server-to-server ไม่มี CORS แนบตรง ๆ ได้:

```ts
const res = await fetch(`${GATEWAY_BASE}/Authen/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-App-Name": "<ชื่อ-repo>" },
    body: JSON.stringify(payload),
});
```

### 2.3 fetch ฝั่ง browser ที่ไม่ผ่าน client กลาง — ใช้ wrapper

ดู `service-management/app/lib/authFetch.ts` (`isGatewayUrl()` + แนบเฉพาะ gateway)

## 3. base URL ที่ใช้กับ gateway (route ที่มีอยู่แล้ว)

| backend เดิม (ยิงตรง) | ผ่าน gateway |
|---|---|
| `service.bevproasia.com/api/v1` · `prod-service.../api/v1` | `…/prod/api/v1` (catch-all, jwt · public 8 เส้น เช่น `/Authen/token`, `/Authen/dispatchtoken`) |
| `service.bevproasia.com:5001/api/v1` (UAT) | `…/uat/api/v1` |
| `onelake-middleware-…azurewebsites.net/api` | `…/api` (routes `mw-*` จาก swagger-sync, jwt) |
| `servicemanagement-…azurewebsites.net` | `…/svc` (strip → host root) |
| `webappbevpro-…azurewebsites.net` (ProjectManagement) | `…/pm` |
| `iotservice.bevproasia.com/api/v1` | `…/iot/v1` |
| `servicemanagement-…/api/v1` (revenue) | `…/revenue/v1` |
| `service.bevproasia.com/api/DisplayImage/Show` | `…/api/DisplayImage/Show` |
| `service.bevproasia.com:7008/matireal` (รูปวัสดุ) | `…/matireal` |
| `soap.bevproasia.com:88` (Inbound2026) | `…/inbound-mobile` |

**ที่ย้ายไม่ได้ (คงตรงไว้ โดยตั้งใจ):** `service.bevproasia.com/api/...` แบบไม่มี `/v1`
(callDocu/callUpload — path `/api` บน gateway เป็น namespace ของ onelake ชนกัน ต้องออก route เฉพาะก่อน) ·
onelake บน NAS ภายใน (`10.10.199.16:4005`, `bevproasia-nas:4005`) — gateway เข้าไม่ถึง ·
การเรียก server ตัวเองของแต่ละเว็บ (Remix/Next loader)

## 4. บันทึก: แต่ละโปรเจกต์ทำอะไรไปแล้ว (2026-08-31 → 09-01)

| repo | ชื่อใน dashboard | จุดที่แก้ (ใช้เป็นตัวอย่าง) | หมายเหตุ |
|---|---|---|---|
| service-management | `service-management` | `app/lib/authFetch.ts` (helper) · `callApi.service.ts` ×2 · 8 หน้า route | + แก้ token ไม่มี `iss` (`server/api/routes/auth.routes.ts`) |
| pro-iot-mobile | `pro-iot-mobile` | `src/Services/appName.ts` + interceptor 5 client + .env ทุกไฟล์ | callDocu/callUpload คงตรง (ดูข้อ 3) |
| pro-iot-board | `pro-iot-board` | `src/Services/appName.ts` + interceptor 4 client + .env 3 ไฟล์ | build:prod แล้วตรวจ bundle = 0 URL ตรง |
| bevpro-safety | `bevpro-safety` | `app/lib/auth.server.ts`, `access-check.server.ts`, `login-report.server.ts` (server fetch ตรง) | |
| bpa-helpdesk | `bpa-helpdesk` | `app/services/auth.server.ts`, `user-sync.server.ts` | URL runtime อยู่ Azure App Settings — แก้แล้ว 2026-09-01 |
| coffee-machine-system | `coffee-machine-system` | `app/lib/api-client.server.ts` + 5 หน้า repair/nespresso + 3 lib | onelake NAS คงตรง |
| bevpro-agentic-app | `bevpro-agentic-app` | 14 ไฟล์ (client/agent tools/ws-proxy) | + แก้ token agent tools ไม่มี `iss` (`so-tracking-tools/auth.ts`) |
| iot | `iot` | `authActions.ts` + `DashboardClient/MobileClient` | |
| bpa-gps-tracking | `bpa-gps-tracking` | `backend/.../notification.service.ts` (backend→SM ผ่าน `/svc`) | |
| **tech-agentic-app (แอปมือถือช่าง)** | — | **ยังไม่ทำ** — repo อยู่เครื่อง Tawan ใช้สูตรข้อ 2.1 | ก้อน `BevProApp` ใน dashboard คือแอปนี้ · ต้อง build + ให้ผู้ใช้อัปเดตแอป |

## 5. เช็คว่าเวิร์กจริง (ทุกครั้งหลังใส่)

1. เปิดแอป → DevTools → Network → filter `bevprogateway` → Request Headers ต้องมี `x-app-name: <ชื่อแอป>`
2. Grafana → "Kong — ใครยิงอะไร" → dropdown "แอป (X-App-Name)" มีชื่อแอปโผล่ · หรือ query ตรง:
   `SELECT app_name, count(*) FROM kong_api_logs WHERE request_time > now()-interval '1 hour' GROUP BY 1`
3. ถ้าเจอ 401 ทั้งที่ login แล้ว → เช็ค token มี claim `iss` ไหม (ข้อ 1.4) ·
   ถ้า browser ขึ้น CORS error → เช็คว่าแนบ header ให้ host ที่ไม่ใช่ gateway หรือเปล่า
