# =====================================================
# Kong Setup: JWT Consumer + Prometheus (Windows)
# =====================================================
# ตั้งค่า Consumer, JWT credential, exception routes,
# Prometheus plugin และ JWT plugin ผ่าน Kong Admin API
# รันซ้ำได้ (idempotent) — PowerShell 5.1 compatible
#
# Usage:
#   .\scripts\setup-jwt-metrics.ps1                 # ตั้งค่าทั้งหมดรวมเปิด JWT plugin
#   .\scripts\setup-jwt-metrics.ps1 -SkipJwtPlugin  # ตั้งค่าทุกอย่างยกเว้น JWT plugin (ยังไม่บังคับ token)
# =====================================================

param(
    [string]$KongAdmin = "http://localhost:8001",
    [string]$EnvFile = "$PSScriptRoot\..\onelake-middleware\.env",
    [switch]$SkipJwtPlugin
)

$ErrorActionPreference = "Stop"

# ─── อ่าน JWT_SECRET จาก .env (ไม่แสดงค่าออกจอ) ───
if (-not (Test-Path $EnvFile)) {
    Write-Host "ERROR: not found $EnvFile" -ForegroundColor Red
    exit 1
}
$secretLine = Select-String -Path $EnvFile -Pattern '^JWT_SECRET=' | Select-Object -First 1
if ($null -eq $secretLine) {
    Write-Host "ERROR: JWT_SECRET not found in $EnvFile" -ForegroundColor Red
    exit 1
}
$jwtSecret = ($secretLine.Line -split '=', 2)[1].Trim()

$issuerLine = Select-String -Path $EnvFile -Pattern '^JWT_ISSUER=' | Select-Object -First 1
$issuer = "onelake-app"
if ($null -ne $issuerLine) {
    $issuer = ($issuerLine.Line -split '=', 2)[1].Trim()
}

# ─── รอ Kong พร้อม ───
Write-Host "Waiting for Kong Admin API..." -NoNewline
$ready = $false
foreach ($i in 1..20) {
    $code = curl.exe -s -o NUL -w "%{http_code}" "$KongAdmin/status"
    if ($code -eq "200") { $ready = $true; break }
    Start-Sleep -Seconds 3
    Write-Host "." -NoNewline
}
if (-not $ready) {
    Write-Host " Kong not reachable at $KongAdmin" -ForegroundColor Red
    exit 1
}
Write-Host " ready" -ForegroundColor Green

# ═══ 1. Consumer (PUT = create-or-update) ═══
Write-Host "`n[1/5] Consumer: $issuer"
curl.exe -s -o NUL -w "  PUT /consumers/$issuer -> HTTP %{http_code}`n" -X PUT "$KongAdmin/consumers/$issuer" --data "custom_id=$issuer" --data "tags[]=app"

# ═══ 2. JWT credential (check-then-POST) ═══
Write-Host "[2/5] JWT credential (key=$issuer, HS256)"
$creds = curl.exe -s "$KongAdmin/consumers/$issuer/jwt" | ConvertFrom-Json
$existing = $creds.data | Where-Object { $_.key -eq $issuer }
if ($null -ne $existing) {
    Write-Host "  credential exists (id=$($existing.id)) -> skip"
} else {
    curl.exe -s -o NUL -w "  POST jwt credential -> HTTP %{http_code}`n" -X POST "$KongAdmin/consumers/$issuer/jwt" --data "key=$issuer" --data "algorithm=HS256" --data-urlencode "secret=$jwtSecret"
}

# ═══ 3. Exception routes — path ยาวกว่า /api จึงชนะ ไม่โดน JWT plugin ═══
Write-Host "[3/5] Exception routes (no JWT)"
curl.exe -s -o NUL -w "  PUT middleware-auth-login-route -> HTTP %{http_code}`n" -X PUT "$KongAdmin/services/onelake-middleware/routes/middleware-auth-login-route" --data "paths[]=/api/auth/login" --data "strip_path=false"
curl.exe -s -o NUL -w "  PUT middleware-request-status-route -> HTTP %{http_code}`n" -X PUT "$KongAdmin/services/onelake-middleware/routes/middleware-request-status-route" --data "paths[]=/api/request-status" --data "strip_path=false"

# ═══ 4. Prometheus plugin (global, check-then-POST) ═══
# หมายเหตุ: OSS ไม่รองรับ ?name= filter บน /plugins — ต้องกรองเองฝั่ง client
Write-Host "[4/5] Prometheus plugin (global, per_consumer=true)"
$plugins = curl.exe -s "$KongAdmin/plugins" | ConvertFrom-Json
$promPlugin = $plugins.data | Where-Object { $_.name -eq "prometheus" } | Select-Object -First 1
if ($null -ne $promPlugin) {
    Write-Host "  prometheus plugin exists (id=$($promPlugin.id)) -> skip"
} else {
    curl.exe -s -o NUL -w "  POST prometheus plugin -> HTTP %{http_code}`n" -X POST "$KongAdmin/plugins" --data "name=prometheus" --data "config.per_consumer=true" --data "config.status_code_metrics=true" --data "config.latency_metrics=true" --data "config.bandwidth_metrics=true" --data "config.upstream_health_metrics=true"
}

# ═══ 5. JWT plugin บน route /api (check-then-POST) ═══
if ($SkipJwtPlugin) {
    Write-Host "[5/5] JWT plugin -> SKIPPED (-SkipJwtPlugin)" -ForegroundColor Yellow
} else {
    Write-Host "[5/5] JWT plugin on middleware-api-route"
    $routePlugins = curl.exe -s "$KongAdmin/routes/middleware-api-route/plugins" | ConvertFrom-Json
    $jwtPlugin = $routePlugins.data | Where-Object { $_.name -eq "jwt" }
    if ($null -ne $jwtPlugin) {
        Write-Host "  jwt plugin exists (id=$($jwtPlugin.id), enabled=$($jwtPlugin.enabled)) -> skip"
    } else {
        curl.exe -s -o NUL -w "  POST jwt plugin -> HTTP %{http_code}`n" -X POST "$KongAdmin/routes/middleware-api-route/plugins" --data "name=jwt" --data "config.key_claim_name=iss" --data "config.claims_to_verify[]=exp"
    }
}

# ─── (ตัวอย่าง) rate limit เฉพาะ consumer — ปรับเลขแล้วเอา comment ออก ───
# curl.exe -s -X POST "$KongAdmin/consumers/$issuer/plugins" --data "name=rate-limiting" --data "config.minute=300" --data "config.hour=8000" --data "config.policy=local" --data "config.limit_by=consumer" --data "config.fault_tolerant=true"

Write-Host "`nDone. Rollback JWT plugin:" -ForegroundColor Green
Write-Host '  $p = (curl.exe -s http://localhost:8001/routes/middleware-api-route/plugins | ConvertFrom-Json).data | Where-Object { $_.name -eq "jwt" }'
Write-Host '  curl.exe -s -X PATCH "http://localhost:8001/plugins/$($p.id)" --data "enabled=false"'
