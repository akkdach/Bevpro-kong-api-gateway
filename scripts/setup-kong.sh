#!/bin/bash
# =====================================================
# 🚀 Kong API Gateway — Setup Script
# =====================================================
# ใช้สำหรับตั้งค่า Services, Routes, และ Plugins
# รวม OneLake Middleware เป็น Upstream Service หลัก
# รันหลังจาก docker compose up สำเร็จแล้ว
# =====================================================

KONG_ADMIN="http://localhost:8001"

echo "⏳ Waiting for Kong to be ready..."
until curl -s "$KONG_ADMIN/status" > /dev/null 2>&1; do
    echo "   Kong is not ready yet. Retrying in 3s..."
    sleep 3
done
echo "✅ Kong is ready!"
echo ""

# ─── ตรวจสอบว่า OneLake Middleware พร้อมใช้งาน ─────
echo "⏳ Waiting for OneLake Middleware to be ready..."
until curl -s "http://onelake-middleware-backend:3005/" > /dev/null 2>&1; do
    echo "   Middleware is not ready yet. Retrying in 3s..."
    sleep 3
done
echo "✅ OneLake Middleware is ready!"
echo ""

# ═══════════════════════════════════════════════
#  SERVICES — กำหนด Upstream API ปลายทาง
# ═══════════════════════════════════════════════

# ─── 1. OneLake Middleware (Node.js — Port 3005) ───
echo "📌 Creating Service: onelake-middleware..."
curl -s -X POST "$KONG_ADMIN/services" \
  --data "name=onelake-middleware" \
  --data "url=http://onelake-middleware-backend:3005" \
  --data "connect_timeout=10000" \
  --data "read_timeout=120000" \
  --data "write_timeout=120000" \
  | python3 -m json.tool 2>/dev/null || echo "(created)"
echo ""

# ─── 2. Main C# API (ถ้ามี — อยู่นอก Docker) ──────
echo "📌 Creating Service: main-api..."
curl -s -X POST "$KONG_ADMIN/services" \
  --data "name=main-api" \
  --data "url=http://host.docker.internal:5000" \
  --data "connect_timeout=10000" \
  --data "read_timeout=60000" \
  --data "write_timeout=60000" \
  | python3 -m json.tool 2>/dev/null || echo "(created)"
echo ""

# ─── 3. Safety Node.js API (ถ้ามี — อยู่นอก Docker) ─
echo "📌 Creating Service: safety-api..."
curl -s -X POST "$KONG_ADMIN/services" \
  --data "name=safety-api" \
  --data "url=http://host.docker.internal:5174" \
  --data "connect_timeout=10000" \
  --data "read_timeout=60000" \
  --data "write_timeout=60000" \
  | python3 -m json.tool 2>/dev/null || echo "(created)"
echo ""

# ═══════════════════════════════════════════════
#  ROUTES — กำหนดเส้นทาง URL ที่เข้ามาทาง Kong
# ═══════════════════════════════════════════════

# ─── Route: /api/* → OneLake Middleware ───────────
# ครอบคลุม: /api/orders, /api/income, /api/sync/*, /api/auth/*, etc.
echo "📌 Creating Route: middleware-api-route..."
curl -s -X POST "$KONG_ADMIN/services/onelake-middleware/routes" \
  --data "name=middleware-api-route" \
  --data "paths[]=/api" \
  --data "strip_path=false" \
  | python3 -m json.tool 2>/dev/null || echo "(created)"
echo ""

# ─── Route: /api-docs → Swagger UI (public, ผ่าน Middleware) ─
echo "📌 Creating Route: middleware-docs-route..."
curl -s -X POST "$KONG_ADMIN/services/onelake-middleware/routes" \
  --data "name=middleware-docs-route" \
  --data "paths[]=/api-docs" \
  --data "strip_path=false" \
  | python3 -m json.tool 2>/dev/null || echo "(created)"
echo ""

# ─── Route: / → Health Check (Middleware root) ────
echo "📌 Creating Route: middleware-health-route..."
curl -s -X POST "$KONG_ADMIN/services/onelake-middleware/routes" \
  --data "name=middleware-health-route" \
  --data "paths[]=/health" \
  --data "strip_path=true" \
  | python3 -m json.tool 2>/dev/null || echo "(created)"
echo ""

# ─── Route: /v1/main/* → Main C# API ────────────
echo "📌 Creating Route: main-api-route..."
curl -s -X POST "$KONG_ADMIN/services/main-api/routes" \
  --data "name=main-api-route" \
  --data "paths[]=/v1/main" \
  --data "strip_path=false" \
  | python3 -m json.tool 2>/dev/null || echo "(created)"
echo ""

# ─── Route: /v1/safety/* → Safety API ───────────
echo "📌 Creating Route: safety-api-route..."
curl -s -X POST "$KONG_ADMIN/services/safety-api/routes" \
  --data "name=safety-api-route" \
  --data "paths[]=/v1/safety" \
  --data "strip_path=false" \
  | python3 -m json.tool 2>/dev/null || echo "(created)"
echo ""

# ═══════════════════════════════════════════════
#  PLUGINS — Global Plugins (ใช้กับทุก Service)
# ═══════════════════════════════════════════════

# ─── Rate Limiting Plugin (Global) ───────────────
echo "📌 Enabling Rate Limiting Plugin (Global)..."
curl -s -X POST "$KONG_ADMIN/plugins" \
  --data "name=rate-limiting" \
  --data "config.minute=200" \
  --data "config.hour=5000" \
  --data "config.policy=local" \
  --data "config.fault_tolerant=true" \
  --data "config.hide_client_headers=false" \
  | python3 -m json.tool 2>/dev/null || echo "(created)"
echo ""

# ─── HTTP Log Plugin → Log Receiver ─────────────
echo "📌 Enabling HTTP Log Plugin (Async Logger)..."
curl -s -X POST "$KONG_ADMIN/plugins" \
  --data "name=http-log" \
  --data "config.http_endpoint=http://log-receiver:3001/logs" \
  --data "config.method=POST" \
  --data "config.timeout=10000" \
  --data "config.keepalive=60000" \
  | python3 -m json.tool 2>/dev/null || echo "(created)"
echo ""

# ─── CORS Plugin (Global) ───────────────────────
echo "📌 Enabling CORS Plugin (Global)..."
curl -s -X POST "$KONG_ADMIN/plugins" \
  --data "name=cors" \
  --data "config.origins[]=*" \
  --data "config.methods[]=GET" \
  --data "config.methods[]=POST" \
  --data "config.methods[]=PUT" \
  --data "config.methods[]=DELETE" \
  --data "config.methods[]=PATCH" \
  --data "config.methods[]=OPTIONS" \
  --data "config.headers[]=Accept" \
  --data "config.headers[]=Authorization" \
  --data "config.headers[]=Content-Type" \
  --data "config.credentials=true" \
  --data "config.max_age=3600" \
  | python3 -m json.tool 2>/dev/null || echo "(created)"
echo ""

# ═══════════════════════════════════════════════
#  PLUGINS — Per-Service (เฉพาะบาง Service)
# ═══════════════════════════════════════════════

# ─── Request Size Limiting สำหรับ Middleware ─────
# Middleware รับ JSON payload สูงสุด 100MB (sync data)
echo "📌 Enabling Request Size Limiting for OneLake Middleware..."
curl -s -X POST "$KONG_ADMIN/services/onelake-middleware/plugins" \
  --data "name=request-size-limiting" \
  --data "config.allowed_payload_size=100" \
  --data "config.size_unit=megabytes" \
  | python3 -m json.tool 2>/dev/null || echo "(created)"
echo ""

# ─── Rate Limiting ที่เข้มขึ้นสำหรับ Sync Routes ─
# Sync API ไม่ต้องเรียกบ่อย จำกัดที่ 10 ครั้ง/นาที
echo "📌 Creating Route: middleware-sync-route (stricter rate limit)..."
curl -s -X POST "$KONG_ADMIN/services/onelake-middleware/routes" \
  --data "name=middleware-sync-route" \
  --data "paths[]=/api/sync" \
  --data "strip_path=false" \
  | python3 -m json.tool 2>/dev/null || echo "(created)"
echo ""

echo "📌 Applying stricter Rate Limit to Sync Routes..."
# ดึง route ID ของ sync route
SYNC_ROUTE_ID=$(curl -s "$KONG_ADMIN/routes/middleware-sync-route" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
if [ -n "$SYNC_ROUTE_ID" ]; then
  curl -s -X POST "$KONG_ADMIN/routes/$SYNC_ROUTE_ID/plugins" \
    --data "name=rate-limiting" \
    --data "config.minute=10" \
    --data "config.policy=local" \
    --data "config.fault_tolerant=true" \
    | python3 -m json.tool 2>/dev/null || echo "(created)"
  echo ""
fi

# ═══════════════════════════════════════════════
#  5. JWT CONSUMER + PROMETHEUS (Windows ใช้ setup-jwt-metrics.ps1 แทน)
# ═══════════════════════════════════════════════
# Consumer ต่อแอป — token ที่ middleware ออกต้องมี claim iss ตรงกับ key ด้านล่าง

ENV_FILE="$(dirname "$0")/../onelake-middleware/.env"
JWT_SECRET=$(grep '^JWT_SECRET=' "$ENV_FILE" | cut -d= -f2-)
JWT_ISSUER=$(grep '^JWT_ISSUER=' "$ENV_FILE" | cut -d= -f2-)
JWT_ISSUER=${JWT_ISSUER:-onelake-app}

if [ -z "$JWT_SECRET" ]; then
  echo "⚠️  JWT_SECRET not found in $ENV_FILE — skipping JWT setup"
else
  echo "📌 Creating Consumer: $JWT_ISSUER..."
  curl -s -X PUT "$KONG_ADMIN/consumers/$JWT_ISSUER" \
    --data "custom_id=$JWT_ISSUER" \
    --data "tags[]=app" > /dev/null && echo "(ok)"

  echo "📌 Creating JWT credential (key=$JWT_ISSUER, HS256)..."
  HAS_CRED=$(curl -s "$KONG_ADMIN/consumers/$JWT_ISSUER/jwt" | python3 -c "import sys,json; print(any(c.get('key')=='$JWT_ISSUER' for c in json.load(sys.stdin).get('data',[])))" 2>/dev/null)
  if [ "$HAS_CRED" = "True" ]; then
    echo "(credential exists — skip)"
  else
    curl -s -X POST "$KONG_ADMIN/consumers/$JWT_ISSUER/jwt" \
      --data "key=$JWT_ISSUER" \
      --data "algorithm=HS256" \
      --data-urlencode "secret=$JWT_SECRET" > /dev/null && echo "(created)"
  fi

  # Routes ยกเว้น JWT — path ยาวกว่า /api จึงชนะตาม router ของ Kong
  echo "📌 Creating exception routes (no JWT)..."
  curl -s -X PUT "$KONG_ADMIN/services/onelake-middleware/routes/middleware-auth-login-route" \
    --data "paths[]=/api/auth/login" --data "strip_path=false" > /dev/null && echo "(login route ok)"
  curl -s -X PUT "$KONG_ADMIN/services/onelake-middleware/routes/middleware-request-status-route" \
    --data "paths[]=/api/request-status" --data "strip_path=false" > /dev/null && echo "(request-status route ok)"

  echo "📌 Enabling JWT Plugin on /api route..."
  HAS_JWT=$(curl -s "$KONG_ADMIN/routes/middleware-api-route/plugins" | python3 -c "import sys,json; print(any(p.get('name')=='jwt' for p in json.load(sys.stdin).get('data',[])))" 2>/dev/null)
  if [ "$HAS_JWT" = "True" ]; then
    echo "(jwt plugin exists — skip)"
  else
    curl -s -X POST "$KONG_ADMIN/routes/middleware-api-route/plugins" \
      --data "name=jwt" \
      --data "config.key_claim_name=iss" \
      --data "config.claims_to_verify[]=exp" > /dev/null && echo "(enabled)"
  fi
fi

echo "📌 Enabling Prometheus Plugin (global, per-consumer metrics)..."
# OSS ไม่รองรับ ?name= filter บน /plugins — กรองด้วยชื่อฝั่ง client
HAS_PROM=$(curl -s "$KONG_ADMIN/plugins" | python3 -c "import sys,json; print(any(p.get('name')=='prometheus' for p in json.load(sys.stdin).get('data',[])))" 2>/dev/null)
if [ "$HAS_PROM" = "True" ]; then
  echo "(prometheus plugin exists — skip)"
else
  curl -s -X POST "$KONG_ADMIN/plugins" \
    --data "name=prometheus" \
    --data "config.per_consumer=true" \
    --data "config.status_code_metrics=true" \
    --data "config.latency_metrics=true" \
    --data "config.bandwidth_metrics=true" \
    --data "config.upstream_health_metrics=true" > /dev/null && echo "(enabled)"
fi
echo ""

# ═══════════════════════════════════════════════
#  SUMMARY — แสดงผลลัพธ์ทั้งหมด
# ═══════════════════════════════════════════════

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   ✅ Kong Setup Complete!                               ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                         ║"
echo "║   🚪 Gateway Proxy:    http://localhost:80               ║"
echo "║   🔧 Admin API:        http://localhost:8001             ║"
echo "║   📊 Kong Manager:     http://localhost:8002             ║"
echo "║   📊 Konga Dashboard:  http://localhost:1337             ║"
echo "║   🔌 Log Receiver:     http://localhost:3001             ║"
echo "║   📈 Prometheus:       http://localhost:9090             ║"
echo "║   📊 Grafana:          http://localhost:3000             ║"
echo "║                                                         ║"
echo "║   ── Registered Services ──                              ║"
echo "║   🖥️  OneLake Middleware  → /api/*                       ║"
echo "║   🖥️  Main C# API        → /v1/main/*                   ║"
echo "║   🖥️  Safety API         → /v1/safety/*                  ║"
echo "║                                                         ║"
echo "║   ── Test Commands ──                                    ║"
echo "║   curl http://localhost/health                           ║"
echo "║   curl http://localhost/api/orders                       ║"
echo "║   curl http://localhost:3001/stats                       ║"
echo "║                                                         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ─── แสดง Routes ทั้งหมดที่ลงทะเบียน ───────────
echo "📋 Registered Routes:"
curl -s "$KONG_ADMIN/routes" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for r in data.get('data', []):
    name = r.get('name', 'unnamed')
    paths = ', '.join(r.get('paths', []))
    svc = r.get('service', {}).get('id', 'N/A')[:8]
    print(f'   → {name:30s}  paths: {paths:20s}  service: {svc}...')
" 2>/dev/null
echo ""
