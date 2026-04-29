# ai-engine'i turbo / start-all.sh ile aynı terminal ömrüne bağlamadan çalıştırır (Windows).
# Yeni konsol penceresi: Ctrl+C burada yalnızca uvicorn'u durdurur; backend+dApp penceresini etkilemez.
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ai = Join-Path $root "apps\ai-engine"
if (-not (Test-Path $ai)) { throw "ai-engine dizini yok: $ai" }

$pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
$shell = if ($pwsh) { $pwsh.Source } else { (Get-Command powershell).Source }

$cmd = @"
Set-Location -LiteralPath '$($ai.Replace("'","''"))'
Write-Host 'ai-engine http://127.0.0.1:8000  (Qwen + optional behavior LoRA, Ctrl+C = dur)' -ForegroundColor Cyan
pnpm dev
"@

Start-Process -FilePath $shell -WorkingDirectory $ai -ArgumentList @(
    "-NoExit",
    "-NoProfile",
    "-Command",
    $cmd
)

Write-Host "Yeni pencerede ai-engine başlatıldı: $ai" -ForegroundColor Green
Write-Host "Sağlık: curl http://127.0.0.1:8000/health" -ForegroundColor DarkGray
