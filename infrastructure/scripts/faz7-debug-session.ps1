# Faz 7 — LoRA / webhook debug öncesi salt-okunur sağlık kontrolü ve log yolu özeti.
# Servis başlatmaz veya yeniden başlatmaz; yalnızca durum yazar.
# Kullanım: pwsh -File infrastructure/scripts/faz7-debug-session.ps1

$ErrorActionPreference = "Continue"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $root

function Show-Status($label, [bool]$ok) {
    "${label}: $(if ($ok) { 'OK' } else { 'FAIL' })"
}

Write-Host "=== Faz 7 — sağlık (salt okunur) ===" -ForegroundColor Cyan
$r = @()
try {
    $r += Show-Status "8080 GET /v1/models" ((Invoke-WebRequest "http://127.0.0.1:8080/v1/models" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200)
}
catch { $r += "8080 GET /v1/models: FAIL" }
try {
    $r += Show-Status "9080 GET /health" ((Invoke-WebRequest "http://127.0.0.1:9080/health" -UseBasicParsing -TimeoutSec 5).Content -match "healthy")
}
catch { $r += "9080 GET /health: FAIL" }
try {
    $r += Show-Status "3000 GET /health" ((Invoke-RestMethod "http://127.0.0.1:3000/health" -TimeoutSec 5).status -eq "ok")
}
catch { $r += "3000 GET /health: FAIL" }
$rp = docker exec r3mes-redis-cache redis-cli PING 2>$null
$r += Show-Status "Redis PING" ($rp -eq "PONG")
$pg = docker exec r3mes-postgres pg_isready -U postgres -d r3mes 2>$null
$r += Show-Status "Postgres pg_isready" ($null -ne $pg -and ($pg -match "accepting"))
$r | ForEach-Object { Write-Host $_ }

Write-Host ""
Write-Host "=== Önerilen log dosyaları (tek deneme; yeniden başlatma yok) ===" -ForegroundColor Cyan
Write-Host "Worker (ortam: R3MES_QA_WORKER_LOG_FILE):"
Write-Host "  $root\logs\faz7-qa-worker.log  (veya mevcut logs\faz6-qa-worker.log)"
Write-Host "Backend (pnpm dev için örnek yönlendirme):"
Write-Host "  $root\backend-faz6-stdout.log"
Write-Host "  $root\backend-faz6-stderr.log"
Write-Host "llama-server:"
Write-Host "  $root\llama-server-faz6-stdout.log"
Write-Host "  $root\llama-server-faz6-stderr.log"
Write-Host ""
Write-Host "Worker tek satırda dosya logu örneği:" -ForegroundColor DarkGray
Write-Host ('  $env:R3MES_QA_WORKER_LOG_FILE="{0}\logs\faz7-qa-worker.log"' -f $root) -ForegroundColor DarkGray
Write-Host '  cd packages\qa-sandbox\worker; python -m r3mes_qa_worker' -ForegroundColor DarkGray
