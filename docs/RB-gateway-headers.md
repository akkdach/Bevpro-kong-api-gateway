# Header ทั้งหมดของระบบ Kong gateway — ใครส่งอะไร ใช้ทำอะไร

รวม HTTP header ทุกตัวที่มีบทบาทในระบบ gateway ของทีม: ขาไป (client → Kong → backend),
ขากลับ (backend → Kong → client), ตัวที่ Kong เพิ่ม/เซ็นเซอร์เอง และวิธีใส่ header
ให้แอปใหม่ (X-App-Name) พร้อมบันทึกว่าแต่ละโปรเจกต์ทำไปแล้วอย่างไร

| | |
|---|---|
| เวอร์ชันเอกสาร | 2026-09-01 |
| ชั้นเอกสาร | B — Dev แก้ได้ |
| เจ้าของ | DevOps (Ronnachai) |
| ใช้กับ | ทุกแอปที่เรียก API ผ่าน `bevprogateway.southeastasia.cloudapp.azure.com` |

---

## 1. Header ขาไป (client → Kong → backend)

| header | ใครส่ง | Kong ทำอะไรกับมัน | ไปโผล่ที่ไหน |
|---|---|---|---|
| `Authorization: Bearer <JWT>` | ทุกแอปหลัง login | **jwt plugin** ตรวจลายเซ็น + `exp` และใช้ claim `iss` หา consumer (`key_claim_name=iss`) — token ไม่มี `iss` = 401 ทันที · **pre-function** ถอดเฉพาะ claim `sub` → คอลัมน์ `jwt_user` (ห้ามเก็บ token ทั้งใบ — claim `email` มีรหัสผ่านจริง) · ตอนส่งเข้า http-log Kong เซ็นเซอร์ค่าเป็น `REDACTED` เอง | log: `jwt_user`, `consumer_username` |
| `X-App-Name: <ชื่อ-repo>` | ทุกแอป (ใส่เองที่ api client กลาง — ดูข้อ 4) | log-receiver อ่านเข้า | log: `app_name` → dashboard "สรุปรายแอป" / "ใครยิงอะไร" |
| `Device_ID: <รหัสเครื่อง>` | แอปมือถือช่าง (ทุก request) | log-receiver อ่านเข้า (Kong แปลงชื่อ header เป็นตัวพิมพ์เล็ก) | log: `device_id` → แยกรายเครื่อง/โควตาเน็ต |
| `Content-Type` | ทุกแอป | **pre-function** ใช้ตัดสินว่าเก็บ request body ไหม — เก็บเฉพาะ JSON / form / text ≤ 4 KB (login ทุกแบบ redact เป็น `[REDACTED login]`, field `password`/`pwd` mask เป็น `***`) | log: `request_body` |
| `x-client-ip` / `x-client-ua` | hub apps (server-to-server ตอนรายงาน login-log ไป SM) | ส่งผ่านเฉยๆ | SM เห็น IP/browser จริงของผู้ใช้ แทน IP ของ server แอป |
| `Origin` + `Access-Control-Request-Method/Headers` | browser ส่งเองตอน preflight (OPTIONS) | **cors plugin** (global) ตอบว่าอนุญาตอะไร | ดู whitelist ข้อ 3 |
| `Host` / SNI | client/Kong | Kong เลือก route · ฝั่ง upstream สำคัญกับ IIS ที่ binding ผูกชื่อ (เช่น `soap.bevproasia.com:88` — ยิงด้วย IP เปล่าโดน `400 Invalid Hostname`) | — |

**Header ที่ Kong เพิ่มให้เองตอนส่งต่อ backend:** `X-Forwarded-For` (IP จริงของ client — backend หลัง
gateway ต้องอ่านตัวนี้แทน remote address), `X-Forwarded-Proto`, `X-Forwarded-Host` ·
บาง route ใช้ **request-transformer** เขียน path/URI ใหม่ (เช่น `/prod/...` → `/api/v1/...`)

## 2. Header ขากลับ (Kong → client) — ใช้ debug เป็นหลัก

| header | ความหมาย | ใช้ตอนไหน |
|---|---|---|
| `Via: kong/3.5.0` | request ผ่าน Kong แล้ว | แยก "error จาก Kong" กับ "error จาก backend" |
| `Server: Microsoft-IIS/10.0` ฯลฯ | ใครเป็นคน**ตอบ**จริง | 404 ที่มี `Server: IIS` = backend ตอบ ไม่ใช่ Kong |
| `X-Kong-Upstream-Latency` | backend ใช้เวลากี่ ms | มีค่า = request ถึง backend แน่นอน · ใช้แยก "Kong ช้า vs backend ช้า" |
| `X-Kong-Proxy-Latency` | Kong เองใช้กี่ ms | ปกติ 0–2 ms |
| `X-Kong-Request-Id` | รหัสตาม request | เอาไป grep ใน log / แจ้งปัญหา ระบุ request เป๊ะๆ |
| `X-RateLimit-Limit-*` / `X-RateLimit-Remaining-*` / `RateLimit-*` | เพดานและโควตาที่เหลือของ rate-limiting | ใกล้ 0 = กำลังจะโดน 429 |
| `WWW-Authenticate: Key realm="kong"` | jwt plugin ของ Kong เป็นคนตอบ 401 | 401+header นี้ = token ไม่ผ่าน Kong (ยังไม่ถึง backend) |
| `Access-Control-Allow-Origin/Headers/Methods/Credentials` | cors plugin ตอบ preflight | browser ใช้ตัดสินว่าปล่อย request จริงไหม |

**สูตรอ่าน error เร็ว:**
`{"message":"no Route matched..."}` = Kong ไม่มี route · 401 + `WWW-Authenticate: Key realm="kong"` = token ไม่ผ่าน Kong ·
4xx/5xx + `Server: IIS/Express` + `X-Kong-Upstream-Latency` = backend ตอบเอง · 502 = Kong ต่อ backend ไม่ได้

## 3. CORS whitelist — จุดที่ต้องแตะเมื่อเว็บจะส่ง header ใหม่

cors plugin (global) บน Kong อนุญาต request header จาก browser เฉพาะ:

```
Accept, Authorization, Content-Type, X-App-Name, Device_ID
```

- เว็บ (browser) จะส่ง header ใหม่นอกลิสต์นี้ → **ต้องเพิ่ม whitelist ก่อน** ไม่งั้น browser
  block ทั้ง request ตั้งแต่ preflight (อาการ: CORS error สีแดงใน console)
- วิธีเพิ่ม: PATCH cors plugin (ดูตัวอย่างใน `scripts/` หรือ Konga → Plugins → cors → `config.headers`)
- แอปมือถือ/ฝั่ง server ไม่มี CORS — ส่งอะไรก็ได้ แต่ log-receiver จะเก็บเฉพาะ header ที่โค้ดรองรับ
- header ใหม่ที่อยากเก็บลง log → ต้องเพิ่ม 3 ที่: คอลัมน์ในตาราง `kong_api_logs`
  (`ALTER TABLE ... ADD COLUMN`) + `log-receiver/server.js` (parse + INSERT) + dashboard

## 4. วิธีใส่ X-App-Name ให้แอปใหม่ (สูตรสำเร็จ)

หลักการ: **แนบเฉพาะ request ที่ปลายทางคือ gateway** (host อื่นไม่ได้ whitelist — browser จะ block) ·
ตั้งชื่อตาม **repo จริงบน GitHub** · ทำที่ **api client กลางจุดเดียว**

### 4.1 axios (React/CRA/React Native)

```ts
// src/Services/appName.ts  (copy จาก pro-iot-mobile / pro-iot-board)
export const APP_NAME = '<ชื่อ-repo>';
export const GATEWAY_HOST = 'bevprogateway.southeastasia.cloudapp.azure.com';

export function attachAppName(config: any) {
    try {
        const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
        const url = new URL(config.url ?? '', config.baseURL ?? origin);
        if (url.host === GATEWAY_HOST && config.headers) {
            config.headers['X-App-Name'] = APP_NAME;   // แบบ AxiosHeaders: config.headers.set(...)
        }
    } catch { /* URL แปลกๆ ก็แค่ไม่แนบ */ }
    return config;
}
```

ใน request interceptor ของทุก axios client: `return config;` → `return attachAppName(config);`

### 4.2 fetch ฝั่ง server (Remix/Next) — แนบตรงได้เลย ไม่มี CORS

```ts
headers: { "Content-Type": "application/json", "X-App-Name": "<ชื่อ-repo>" }
```

### 4.3 fetch ฝั่ง browser นอก client กลาง — ใช้ wrapper ที่เช็ค host ก่อน
ดู `service-management/app/lib/authFetch.ts` (`isGatewayUrl()`)

### กับดักที่เจอมาแล้ว
1. **token ที่แอป mint เองต้องมี claim `iss`/`aud`** (ค่า = consumer key ใน Kong เช่น `JWT_ISSUER`)
   ไม่งั้น 401 ทุกเส้น — เจอจริง 2 ที่: `service-management` (MS/Firebase login) และ
   `bevpro-agentic-app/app/lib/agent/so-tracking-tools/auth.ts`
2. อย่าตั้งชื่อเล่น — ใช้ชื่อ repo (เคยตั้ง `iot-dashboard` แล้วต้องแก้เป็น `iot`)
3. duplicate key ใน headers object (แทรกซ้ำ) — TS ไม่ฟ้องเสมอ ตรวจด้วยตา

## 5. ตารางแปลง base URL → gateway (route ที่มีอยู่แล้ว)

| backend เดิม (ยิงตรง) | ผ่าน gateway |
|---|---|
| `service.bevproasia.com/api/v1` · `prod-service.../api/v1` | `…/prod/api/v1` (catch-all, jwt · public 8 เส้น) |
| `service.bevproasia.com:5001/api/v1` (UAT) | `…/uat/api/v1` |
| `onelake-middleware-…azurewebsites.net/api` | `…/api` (routes `mw-*`, jwt) |
| `servicemanagement-…azurewebsites.net` | `…/svc` |
| `webappbevpro-…azurewebsites.net` (ProjectManagement) | `…/pm` |
| `iotservice.bevproasia.com/api/v1` | `…/iot/v1` |
| revenue (SM `/api/v1`) | `…/revenue/v1` |
| `service.bevproasia.com/api/DisplayImage/Show` | `…/api/DisplayImage/Show` |
| `service.bevproasia.com:7008/matireal` | `…/matireal` |
| `soap.bevproasia.com:88` (Inbound2026) | `…/inbound-mobile` |

**คงตรงไว้โดยตั้งใจ:** `service.bevproasia.com/api/...` ที่ไม่มี `/v1` (callDocu/callUpload — path `/api`
บน gateway เป็นของ onelake) · onelake NAS ภายใน (`10.10.199.16:4005`) · การเรียก server ตัวเองของแต่ละเว็บ

## 6. บันทึกรายโปรเจกต์ (ทำแล้ว 2026-08-31 → 09-01)

| repo | ชื่อใน dashboard | จุดที่แก้ (ใช้เป็นตัวอย่าง) | หมายเหตุ |
|---|---|---|---|
| service-management | `service-management` | `app/lib/authFetch.ts` + `callApi.service.ts` ×2 + 8 หน้า | + แก้ token ไม่มี `iss` |
| pro-iot-mobile | `pro-iot-mobile` | `src/Services/appName.ts` + interceptor 5 client + .env | callDocu/callUpload คงตรง |
| pro-iot-board | `pro-iot-board` | `src/Services/appName.ts` + interceptor 4 client + .env 3 ไฟล์ | ตรวจ bundle แล้ว 0 URL ตรง |
| bevpro-safety | `bevpro-safety` | `auth.server.ts`, `access-check.server.ts`, `login-report.server.ts` | |
| bpa-helpdesk | `bpa-helpdesk` | `auth.server.ts`, `user-sync.server.ts` | URL runtime = Azure App Settings (แก้แล้ว 09-01) |
| coffee-machine-system | `coffee-machine-system` | `api-client.server.ts` + 5 หน้า + 3 lib | onelake NAS คงตรง |
| bevpro-agentic-app | `bevpro-agentic-app` | 14 ไฟล์ + `authHeaders()` กลาง | + แก้ token agent tools ไม่มี `iss` |
| iot | `iot` | `authActions.ts` + 2 component | |
| bpa-gps-tracking | `bpa-gps-tracking` | `backend/.../notification.service.ts` | |
| **tech-agentic-app (มือถือช่าง)** | — | **ยังไม่ทำ** — ใช้สูตร 4.1 | ก้อน `BevProApp` ใน dashboard คือแอปนี้ · ต้อง build + ผู้ใช้อัปเดตแอป |

## 7. เช็คหลังใส่ (ทุกครั้ง)

1. DevTools → Network → filter `bevprogateway` → Request Headers มี `x-app-name` · Response Headers มี `Via: kong`
2. Grafana "ใครยิงอะไร" → dropdown "แอป (X-App-Name)" มีชื่อโผล่ · หรือ:
   `SELECT app_name, count(*) FROM kong_api_logs WHERE request_time > now()-interval '1 hour' GROUP BY 1`
3. 401 ทั้งที่ login แล้ว → เช็ค `WWW-Authenticate` (Kong หรือ backend) แล้วไล่เรื่อง `iss` ตามข้อ 4
4. CORS error → เช็คว่าแนบ header ให้ host นอก gateway หรือ header ใหม่ยังไม่อยู่ใน whitelist (ข้อ 3)
