# =====================================================
# fix-my-ip.ps1 — เติม IP ปัจจุบันของเครื่องที่รันสคริปต์นี้เข้า allow list ทุกชั้น
#
# ปัญหาที่แก้: เน็ตออฟฟิศเป็น dynamic IP (เปลี่ยน 3 ครั้งใน 3 วัน — 171.103.89.247,
#   87.124.104.34, 124.120.31.223, 124.122.190.153) พอเปลี่ยนแล้วจะเจอ
#     - SSH เข้า VM ไม่ได้ / เปิด Grafana, Konga, Admin API ไม่ได้   -> ติด NSG ของ Azure
#     - ยิง /sap-pi แล้วได้ "IP address not allowed"                 -> ติด ip-restriction ของ Kong
#   สองอย่างนี้คนละชั้นกัน ต้องเติมทั้งคู่
#
# วิธีใช้ (PowerShell บนเครื่องแอดมิน ต้อง az login ไว้แล้ว):
#   .\scripts\fix-my-ip.ps1              # เติมเฉพาะ NSG (พอสำหรับ SSH / Grafana / Admin API)
#   .\scripts\fix-my-ip.ps1 -WhatIf      # ดูว่าจะแก้อะไรบ้าง ยังไม่แก้จริง
#   .\scripts\fix-my-ip.ps1 -IncludeKong # เติม Kong ip-restriction ของ sap-pi-uat-soap (/sap-pi-uat) ด้วย
#
# ผู้ดูแลตัดสินใจ 2026-10-01 ว่าให้ยิง /sap-pi จากออฟฟิศได้ -> ปกติรันด้วย -IncludeKong เสมอ
# หลังรันแล้วอย่าลืมเติม IP ใหม่ลง scripts/add-sap-egress-route.sh ด้วย
# (สคริปต์นั้นเขียนทับ allow list ทั้งชุด ถ้าไม่เติม รันครั้งหน้า IP จะหายไป)
#
# az ทำงานผ่าน Azure control plane จึงรันได้แม้ NSG ยังบล็อกเครื่องเราอยู่
# ส่วนขั้น Kong ต้องให้ NSG เปิดพอร์ต 8001 ให้เราก่อน สคริปต์จึงทำ NSG ก่อนเสมอ
# =====================================================
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$IncludeKong,
    [string]$ResourceGroup = "WEBAPPLICATION_GROUP",
    [string]$NsgName       = "WebApplication-kong-gateway-nsg",
    [string]$KongAdmin     = "http://20.6.32.81:8001",
    # /sap-pi-uat เท่านั้น (route /sap-pi ถูกลบ 2026-10-07) — ห้ามใส่ sap-pi-prod-soap: ไม่ยิง SAP PRD จากออฟฟิศ
    [string[]]$KongRoute   = @("sap-pi-uat-soap")
)

$ErrorActionPreference = "Stop"
$rules = @("Allow-SSH-AdminOnly", "Allow-Admin-Dashboards", "Allow-Postgres-Admin")

# --- 1. หา IP ขาออกปัจจุบัน (ต้องเป็น IPv4 — NSG/Kong ใช้ IPv4 · เน็ตออฟฟิศออก IPv6 ด้วย
#        ถ้าถาม ifconfig.me ตรงๆ จะได้ 2001:fb1:... ใช้ไม่ได้ → ใช้ api.ipify.org ที่ตอบ IPv4 เท่านั้น) ---
$myIp = $null
foreach ($svc in @("https://api.ipify.org", "https://ipv4.icanhazip.com")) {
    try {
        $cand = (Invoke-RestMethod -Uri $svc -TimeoutSec 10).ToString().Trim()
        if ($cand -match '^\d{1,3}(\.\d{1,3}){3}$') { $myIp = $cand; break }
    } catch { }
}
if (-not $myIp) {
    Write-Host "หา IPv4 ตัวเองไม่ได้ (ลอง api.ipify.org และ ipv4.icanhazip.com แล้ว)" -ForegroundColor Red
    exit 1
}
if ($myIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    Write-Host "ค่าที่ได้ไม่ใช่ IPv4: $myIp" -ForegroundColor Red
    exit 1
}
Write-Host "IP ปัจจุบันของเครื่องนี้: $myIp" -ForegroundColor Cyan

# --- 2. เติมเข้า NSG ทีละกฎ (อ่านค่าเดิมมารวม ไม่ทับของเดิม) ---
foreach ($rule in $rules) {
    $existing = (az network nsg rule show -g $ResourceGroup --nsg-name $NsgName -n $rule `
                    --query "sourceAddressPrefixes" -o tsv 2>$null)
    if (-not $?) { Write-Host "  $rule : อ่านกฎไม่ได้ (ชื่อผิดหรือไม่มีสิทธิ์) ข้าม" -ForegroundColor Yellow; continue }

    $list = @($existing -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($list -contains $myIp) {
        Write-Host "  $rule : มี $myIp อยู่แล้ว" -ForegroundColor DarkGray
        continue
    }

    $new = $list + $myIp
    if ($PSCmdlet.ShouldProcess($rule, "เพิ่ม $myIp (รวมเป็น $($new.Count) IP)")) {
        az network nsg rule update -g $ResourceGroup --nsg-name $NsgName -n $rule `
            --source-address-prefixes $new -o none
        if ($?) { Write-Host "  $rule : เพิ่ม $myIp แล้ว (รวม $($new.Count) IP)" -ForegroundColor Green }
        else    { Write-Host "  $rule : อัปเดตไม่สำเร็จ" -ForegroundColor Red }
    }
}

# --- 3. เติมเข้า Kong ip-restriction ---
#   route แอดมิน (grafana-admin, prometheus-admin) มี ip-restriction ของตัวเอง คนละตัวกับ /sap-pi
#   เจอจริง 2026-10-05: NSG เปิดแล้วแต่ Grafana ยังขึ้น "IP address not allowed" เพราะลืมชั้นนี้
#   → ทำ route แอดมินทุกครั้ง ส่วน sap-pi-soap ทำเมื่อสั่ง -IncludeKong
$kongRoutes = @("grafana-admin", "prometheus-admin")
if ($IncludeKong) { $kongRoutes += $KongRoute }

Write-Host "`nKong ip-restriction" -ForegroundColor Cyan
Write-Host "  (รอ NSG มีผลก่อน ~10 วิ)" -ForegroundColor DarkGray
Start-Sleep -Seconds 10

foreach ($route in $kongRoutes) {
    try {
        $plugins = Invoke-RestMethod -Uri "$KongAdmin/routes/$route/plugins" -TimeoutSec 15
    } catch {
        Write-Host "  $route : ต่อ Admin API ไม่ได้ — $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  NSG อาจยังไม่ทันมีผล รอ 30 วิแล้วรันใหม่" -ForegroundColor Yellow
        exit 1
    }
    $plugin = $plugins.data | Where-Object { $_.name -eq "ip-restriction" } | Select-Object -First 1
    if (-not $plugin) { Write-Host "  $route : ไม่มี ip-restriction ข้าม" -ForegroundColor DarkGray; continue }

    $allow = @($plugin.config.allow)
    if ($allow -contains $myIp) { Write-Host "  $route : มี $myIp อยู่แล้ว" -ForegroundColor DarkGray; continue }

    $allow += $myIp
    if ($PSCmdlet.ShouldProcess("route $route", "เพิ่ม $myIp เข้า allow list")) {
        # ส่งเป็น form-urlencoded แบบ config.allow[]=... ทีละค่า (รูปแบบเดียวกับสคริปต์ .sh ใน repo)
        $body = ($allow | ForEach-Object { "config.allow[]=$([uri]::EscapeDataString($_))" }) -join "&"
        try {
            $res = Invoke-RestMethod -Uri "$KongAdmin/plugins/$($plugin.id)" -Method Patch `
                     -ContentType "application/x-www-form-urlencoded" -Body $body -TimeoutSec 15
            Write-Host "  $route : เพิ่มแล้ว (รวม $($res.config.allow.Count) IP)" -ForegroundColor Green
        } catch {
            Write-Host "  $route : PATCH ไม่สำเร็จ — $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}
if (-not $IncludeKong) {
    Write-Host "`nข้าม route $($KongRoute -join ', ') (ใส่ -IncludeKong ถ้าต้องยิง /sap-pi-uat จากเครื่องนี้)" -ForegroundColor DarkGray
}

Write-Host "`nเสร็จ — อย่าลืมเติม IP นี้ลง scripts/add-sap-egress-route.sh ด้วย" -ForegroundColor Cyan
Write-Host "ไม่งั้นรันสคริปต์นั้นครั้งหน้า allow list จะถูกเขียนทับกลับเป็นชุดเดิม" -ForegroundColor Yellow
