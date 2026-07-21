# =====================================================
# Kong Full Setup for NAS deployment (run from Windows)
# =====================================================
# ตั้งค่า Kong ทั้งหมด (services + routes + plugins + JWT + Prometheus)
# ยิงผ่าน Admin API ของ NAS โดยตรง — รันซ้ำได้ (idempotent)
#
# Usage:
#   .\scripts\setup-nas.ps1 -KongAdmin http://10.10.199.16:8001
#   .\scripts\setup-nas.ps1 -KongAdmin http://10.10.199.16:8001 -SkipJwtPlugin
# =====================================================

param(
    [string]$KongAdmin = "http://10.10.199.16:8001",
    [string]$EnvFile = "$PSScriptRoot\..\onelake-middleware\.env",
    [string]$UpstreamUrl = "https://onelake-middleware-hth2cxh5hfhwdxhs.southeastasia-01.azurewebsites.net",
    [switch]$SkipJwtPlugin
)

$ErrorActionPreference = "Stop"

function Post-IfMissing($listUrl, $namePredicate, $createUrl, $dataArgs, $label) {
    # generic check-then-POST helper
    $existing = (curl.exe -s $listUrl | ConvertFrom-Json).data | Where-Object $namePredicate | Select-Object -First 1
    if ($null -ne $existing) {
        Write-Host "  $label exists -> skip"
        return
    }
    $args = @("-s", "-o", "NUL", "-w", "  $label -> HTTP %{http_code}`n", "-X", "POST", $createUrl) + $dataArgs
    & curl.exe @args
}

# ─── อ่าน JWT_SECRET ───
if (-not (Test-Path $EnvFile)) { Write-Host "ERROR: not found $EnvFile" -ForegroundColor Red; exit 1 }
$secretLine = Select-String -Path $EnvFile -Pattern '^JWT_SECRET=' | Select-Object -First 1
if ($null -eq $secretLine) { Write-Host "ERROR: JWT_SECRET not found" -ForegroundColor Red; exit 1 }
$jwtSecret = ($secretLine.Line -split '=', 2)[1].Trim()
$issuerLine = Select-String -Path $EnvFile -Pattern '^JWT_ISSUER=' | Select-Object -First 1
$issuer = if ($null -ne $issuerLine) { ($issuerLine.Line -split '=', 2)[1].Trim() } else { "onelake-app" }

# ─── รอ Kong ───
Write-Host "Waiting for Kong Admin API at $KongAdmin..." -NoNewline
$ready = $false
foreach ($i in 1..20) {
    $code = curl.exe -s -o NUL -w "%{http_code}" "$KongAdmin/status"
    if ($code -eq "200") { $ready = $true; break }
    Start-Sleep -Seconds 3; Write-Host "." -NoNewline
}
if (-not $ready) { Write-Host " not reachable" -ForegroundColor Red; exit 1 }
Write-Host " ready" -ForegroundColor Green

# ═══ SERVICES (PUT = idempotent) ═══
Write-Host "`n[Services]"
curl.exe -s -o NUL -w "  onelake-middleware -> HTTP %{http_code}`n" -X PUT "$KongAdmin/services/onelake-middleware" --data-urlencode "url=$UpstreamUrl" --data "connect_timeout=10000" --data "read_timeout=120000" --data "write_timeout=120000"
curl.exe -s -o NUL -w "  main-api -> HTTP %{http_code}`n" -X PUT "$KongAdmin/services/main-api" --data "url=http://host.docker.internal:5000" --data "connect_timeout=10000" --data "read_timeout=60000" --data "write_timeout=60000"
curl.exe -s -o NUL -w "  safety-api -> HTTP %{http_code}`n" -X PUT "$KongAdmin/services/safety-api" --data "url=http://host.docker.internal:5174" --data "connect_timeout=10000" --data "read_timeout=60000" --data "write_timeout=60000"

# ═══ ROUTES (nested PUT = idempotent) ═══
Write-Host "[Routes]"
curl.exe -s -o NUL -w "  middleware-api-route -> HTTP %{http_code}`n" -X PUT "$KongAdmin/services/onelake-middleware/routes/middleware-api-route" --data "paths[]=/api" --data "strip_path=false"
curl.exe -s -o NUL -w "  middleware-docs-route -> HTTP %{http_code}`n" -X PUT "$KongAdmin/services/onelake-middleware/routes/middleware-docs-route" --data "paths[]=/api-docs" --data "strip_path=false"
curl.exe -s -o NUL -w "  middleware-health-route -> HTTP %{http_code}`n" -X PUT "$KongAdmin/services/onelake-middleware/routes/middleware-health-route" --data "paths[]=/health" --data "strip_path=true"
curl.exe -s -o NUL -w "  main-api-route -> HTTP %{http_code}`n" -X PUT "$KongAdmin/services/main-api/routes/main-api-route" --data "paths[]=/v1/main" --data "strip_path=false"
curl.exe -s -o NUL -w "  safety-api-route -> HTTP %{http_code}`n" -X PUT "$KongAdmin/services/safety-api/routes/safety-api-route" --data "paths[]=/v1/safety" --data "strip_path=false"
curl.exe -s -o NUL -w "  middleware-sync-route -> HTTP %{http_code}`n" -X PUT "$KongAdmin/services/onelake-middleware/routes/middleware-sync-route" --data "paths[]=/api/sync" --data "strip_path=false"
# exception routes (path ยาวกว่า /api -> ไม่โดน jwt plugin)
curl.exe -s -o NUL -w "  middleware-auth-login-route -> HTTP %{http_code}`n" -X PUT "$KongAdmin/services/onelake-middleware/routes/middleware-auth-login-route" --data "paths[]=/api/auth/login" --data "strip_path=false"
curl.exe -s -o NUL -w "  middleware-request-status-route -> HTTP %{http_code}`n" -X PUT "$KongAdmin/services/onelake-middleware/routes/middleware-request-status-route" --data "paths[]=/api/request-status" --data "strip_path=false"

# ═══ GLOBAL PLUGINS (check-then-POST; global = ไม่ผูก route/service/consumer) ═══
Write-Host "[Global plugins]"
Post-IfMissing "$KongAdmin/plugins" { $_.name -eq "rate-limiting" -and $null -eq $_.route -and $null -eq $_.service -and $null -eq $_.consumer } "$KongAdmin/plugins" @("--data","name=rate-limiting","--data","config.minute=200","--data","config.hour=5000","--data","config.policy=local","--data","config.fault_tolerant=true","--data","config.hide_client_headers=false") "rate-limiting(global)"
Post-IfMissing "$KongAdmin/plugins" { $_.name -eq "http-log" } "$KongAdmin/plugins" @("--data","name=http-log","--data","config.http_endpoint=http://log-receiver:3001/logs","--data","config.method=POST","--data","config.timeout=10000","--data","config.keepalive=60000") "http-log"
Post-IfMissing "$KongAdmin/plugins" { $_.name -eq "cors" } "$KongAdmin/plugins" @("--data","name=cors","--data","config.origins[]=*","--data","config.methods[]=GET","--data","config.methods[]=POST","--data","config.methods[]=PUT","--data","config.methods[]=DELETE","--data","config.methods[]=PATCH","--data","config.methods[]=OPTIONS","--data","config.headers[]=Accept","--data","config.headers[]=Authorization","--data","config.headers[]=Content-Type","--data","config.credentials=true","--data","config.max_age=3600") "cors"
Post-IfMissing "$KongAdmin/plugins" { $_.name -eq "prometheus" } "$KongAdmin/plugins" @("--data","name=prometheus","--data","config.per_consumer=true","--data","config.status_code_metrics=true","--data","config.latency_metrics=true","--data","config.bandwidth_metrics=true","--data","config.upstream_health_metrics=true") "prometheus"

# ═══ SCOPED PLUGINS ═══
Write-Host "[Scoped plugins]"
Post-IfMissing "$KongAdmin/services/onelake-middleware/plugins" { $_.name -eq "request-size-limiting" } "$KongAdmin/services/onelake-middleware/plugins" @("--data","name=request-size-limiting","--data","config.allowed_payload_size=100","--data","config.size_unit=megabytes") "request-size-limiting(mw)"
Post-IfMissing "$KongAdmin/routes/middleware-sync-route/plugins" { $_.name -eq "rate-limiting" } "$KongAdmin/routes/middleware-sync-route/plugins" @("--data","name=rate-limiting","--data","config.minute=10","--data","config.policy=local","--data","config.fault_tolerant=true") "rate-limiting(sync)"

# ═══ CONSUMER + JWT CREDENTIAL ═══
Write-Host "[Consumer]"
curl.exe -s -o NUL -w "  consumer $issuer -> HTTP %{http_code}`n" -X PUT "$KongAdmin/consumers/$issuer" --data "custom_id=$issuer" --data "tags[]=app"
$creds = curl.exe -s "$KongAdmin/consumers/$issuer/jwt" | ConvertFrom-Json
if (($creds.data | Where-Object { $_.key -eq $issuer })) {
    Write-Host "  jwt credential exists -> skip"
} else {
    curl.exe -s -o NUL -w "  jwt credential -> HTTP %{http_code}`n" -X POST "$KongAdmin/consumers/$issuer/jwt" --data "key=$issuer" --data "algorithm=HS256" --data-urlencode "secret=$jwtSecret"
}

# ═══ JWT PLUGIN ═══
if ($SkipJwtPlugin) {
    Write-Host "[JWT plugin] SKIPPED" -ForegroundColor Yellow
} else {
    Write-Host "[JWT plugin]"
    Post-IfMissing "$KongAdmin/routes/middleware-api-route/plugins" { $_.name -eq "jwt" } "$KongAdmin/routes/middleware-api-route/plugins" @("--data","name=jwt","--data","config.key_claim_name=iss","--data","config.claims_to_verify[]=exp") "jwt(middleware-api-route)"
}

Write-Host "`nDone. ทดสอบ:" -ForegroundColor Green
Write-Host "  curl.exe -s -o NUL -w `"%{http_code}`" http://10.10.199.16:8090/api/orders   (คาดว่า 401)"
Write-Host "  curl.exe -s http://10.10.199.16:8090/health   (คาดว่า 200)"
