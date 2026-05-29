#!/bin/bash
# =====================================================
# 🧪 Kong + OneLake Middleware — Load Test
# =====================================================
# ทดสอบ High Concurrency ผ่าน Kong Gateway
# ครอบคลุม OneLake Middleware endpoints
# =====================================================

SERVER_IP="${1:-localhost}"
TOKEN="${2:-your_jwt_token_here}"

echo "╔══════════════════════════════════════════════╗"
echo "║   🧪 Kong + OneLake Middleware Load Test     ║"
echo "╠══════════════════════════════════════════════╣"
echo "║   Server: $SERVER_IP"
echo "║   Concurrency: 150 users"
echo "║   Total Requests: 10,000"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ═══ Test 0: Health Check ═══
echo "─── Test 0: Health Check (via Kong) ───"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://$SERVER_IP/health")
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Health check passed (HTTP $HTTP_CODE)"
else
    echo "❌ Health check failed (HTTP $HTTP_CODE)"
    echo "⚠️  ตรวจสอบว่า Kong + Middleware ทำงานอยู่"
    exit 1
fi
echo ""

# ═══ Test 1: OneLake Middleware — /api/orders ═══
echo "─── Test 1: OneLake Middleware /api/orders (via Kong) ───"
ab -n 10000 -c 150 \
  -H "Authorization: Bearer $TOKEN" \
  "http://$SERVER_IP/api/orders?wk_ctr=BPA_BANGNA"
echo ""

# ═══ Test 2: OneLake Middleware — /api/income ═══
echo "─── Test 2: OneLake Middleware /api/income (via Kong) ───"
ab -n 5000 -c 100 \
  -H "Authorization: Bearer $TOKEN" \
  "http://$SERVER_IP/api/income?wk_ctr=BPA_BANGNA"
echo ""

# ═══ Test 3: Main C# API (ถ้ามี) ═══
echo "─── Test 3: Main C# API /v1/main/* (via Kong) ───"
ab -n 10000 -c 150 \
  -H "Authorization: Bearer $TOKEN" \
  "http://$SERVER_IP/v1/main/workorder?wk_ctr=BPA_BANGNA" 2>/dev/null || \
  echo "⚠️  Main C# API ไม่พร้อมใช้งาน (ข้ามไป)"
echo ""

# ═══ Results: Log Receiver Stats ═══
echo "─── Log Receiver Stats ───"
curl -s "http://$SERVER_IP:3001/stats" | python3 -m json.tool 2>/dev/null || echo "(unavailable)"
echo ""

# ═══ Results: PostgreSQL Log Count ═══
echo "─── PostgreSQL Log Count ───"
docker exec kong-database psql -U kong -d kong -c \
  "SELECT
     COUNT(*) as total_logs,
     ROUND(AVG(latency_ms)::numeric, 2) as avg_latency_ms,
     MIN(request_time) as first_log,
     MAX(request_time) as last_log
   FROM kong_api_logs;"
echo ""

# ═══ Results: Top Routes by Request Count ═══
echo "─── Top Routes by Request Count ───"
docker exec kong-database psql -U kong -d kong -c \
  "SELECT
     service_name,
     path,
     COUNT(*) as requests,
     ROUND(AVG(latency_ms)::numeric, 2) as avg_latency_ms,
     COUNT(*) FILTER(WHERE status_code >= 500) as errors_5xx
   FROM kong_api_logs
   GROUP BY service_name, path
   ORDER BY requests DESC
   LIMIT 10;"
echo ""

# ═══ Results: Kong Rate Limiting Headers ═══
echo "─── Rate Limiting Headers Check ───"
curl -sI -H "Authorization: Bearer $TOKEN" "http://$SERVER_IP/api/orders" | grep -i "ratelimit"
echo ""

echo "╔══════════════════════════════════════════════╗"
echo "║   ✅ Load test complete!                     ║"
echo "╚══════════════════════════════════════════════╝"
