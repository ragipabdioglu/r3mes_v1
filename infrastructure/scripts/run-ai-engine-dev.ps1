param(
    [switch] $EmbeddingOnly
)

# ai-engine'i turbo / start-all.sh ile aynı terminal ömrüne bağlamadan çalıştırır (Windows).
# Yeni konsol penceresi: Ctrl+C burada yalnızca uvicorn'u durdurur; backend+dApp penceresini etkilemez.
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ai = Join-Path $root "apps\ai-engine"
if (-not (Test-Path $ai)) { throw "ai-engine dizini yok: $ai" }

$pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
$shell = if ($pwsh) { $pwsh.Source } else { (Get-Command powershell).Source }

$modeTitle = if ($EmbeddingOnly) { "BGE-M3 embedding/reranker only" } else { "Qwen + optional behavior LoRA" }
$envOverrides = if ($EmbeddingOnly) {
@"
`$env:R3MES_INFERENCE_BACKEND='transformers_peft'
`$env:R3MES_SKIP_LLAMA='true'
"@
} else {
    ""
}

$cmd = @"
Set-Location -LiteralPath '$($ai.Replace("'","''"))'
Write-Host 'ai-engine http://127.0.0.1:8000  ($modeTitle, Ctrl+C = dur)' -ForegroundColor Cyan
$envOverrides
pnpm dev
"@

Start-Process -FilePath $shell -WorkingDirectory $ai -ArgumentList @(
    "-NoExit",
    "-NoProfile",
    "-Command",
    $cmd
)

Write-Host "Yeni pencerede ai-engine başlatıldı: $ai" -ForegroundColor Green
if ($EmbeddingOnly) {
    Write-Host "Embedding smoke: `$env:R3MES_REQUIRE_REAL_EMBEDDINGS='1'; pnpm --filter @r3mes/backend-api run smoke:embedding-provider" -ForegroundColor DarkGray
}
Write-Host "Sağlık: curl http://127.0.0.1:8000/health" -ForegroundColor DarkGray
