#!/usr/bin/env pwsh
param(
  [ValidateSet("start", "stop", "status")]
  [string] $Action = "status",
  [string] $ModelPath = "C:\r3mes-model-cache\qwen2.5-3b-instruct-q5_k_m.gguf",
  [string] $LoraPath = "C:\r3mes-lora\doctor-role-qwen3b-v3.gguf"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Logs = Join-Path $Root "logs"
$LlamaBin = Join-Path $Root "infrastructure\llama-runtime\win-vulkan-x64\llama-server.exe"
$PythonBin = Join-Path $Root ".venv-training-hf\Scripts\python.exe"

function Ensure-Logs {
  New-Item -ItemType Directory -Force -Path $Logs | Out-Null
}

function Get-ListenProcessIds([int[]] $Ports) {
  Get-NetTCPConnection -LocalPort $Ports -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
}

function Test-HttpOk([string] $Url) {
  try {
    $res = Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 8
    return $res.StatusCode -ge 200 -and $res.StatusCode -lt 300
  } catch {
    return $false
  }
}

function Test-JsonHealth([string] $Url) {
  try {
    $res = Invoke-RestMethod $Url -TimeoutSec 8
    return $res.status -eq "ok"
  } catch {
    return $false
  }
}

function Show-Status {
  $rows = @(
    [pscustomobject]@{ Service = "backend-api"; Port = 3000; OK = (Test-JsonHealth "http://127.0.0.1:3000/health") }
    [pscustomobject]@{ Service = "dApp"; Port = 3001; OK = (Test-HttpOk "http://127.0.0.1:3001") }
    [pscustomobject]@{ Service = "ai-engine"; Port = 8000; OK = (Test-JsonHealth "http://127.0.0.1:8000/health") }
    [pscustomobject]@{ Service = "qdrant"; Port = 6333; OK = (Test-HttpOk "http://127.0.0.1:6333/healthz") }
    [pscustomobject]@{ Service = "llama"; Port = 8080; OK = (Test-HttpOk "http://127.0.0.1:8080/v1/models") }
    [pscustomobject]@{ Service = "ipfs-gateway"; Port = 9080; OK = (Test-HttpOk "http://127.0.0.1:9080/health") }
  )

  $rows | Format-Table -AutoSize

  try {
    $adapters = Invoke-RestMethod "http://127.0.0.1:8080/lora-adapters" -TimeoutSec 8
    "LoRA adapters:"
    $adapters | ConvertTo-Json -Depth 5
  } catch {
    "LoRA adapters: unavailable"
  }

  "Docker:"
  docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
}

function Start-System {
  Ensure-Logs
  Push-Location $Root
  try {
    pnpm bootstrap

    if (-not (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue)) {
      $llamaArgs = @(
        "-m", $ModelPath,
        "--host", "127.0.0.1",
        "--port", "8080",
        "--ctx-size", "4096",
        "-ngl", "999"
      )
      if (Test-Path $LoraPath) {
        $llamaArgs += @("--lora-init-without-apply", "--lora", $LoraPath)
      }
      Start-Process -FilePath $LlamaBin -ArgumentList $llamaArgs -WorkingDirectory $Root -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $Logs "llama-server.out.log") `
        -RedirectStandardError (Join-Path $Logs "llama-server.err.log") | Out-Null
    }
    Start-Sleep -Seconds 10

    if (-not (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)) {
      Start-Process -FilePath $PythonBin -ArgumentList "-m","uvicorn","r3mes_ai_engine.app:app","--host","0.0.0.0","--port","8000" `
        -WorkingDirectory (Join-Path $Root "apps\ai-engine") -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $Logs "ai-engine.out.log") `
        -RedirectStandardError (Join-Path $Logs "ai-engine.err.log") | Out-Null
    }
    Start-Sleep -Seconds 5

    if (-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
      Start-Process -FilePath "node" -ArgumentList "--env-file=.env","dist/index.js" `
        -WorkingDirectory (Join-Path $Root "apps\backend-api") -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $Logs "backend.out.log") `
        -RedirectStandardError (Join-Path $Logs "backend.err.log") | Out-Null
    }
    Start-Sleep -Seconds 4

    if (-not (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue)) {
      Start-Process -FilePath "cmd.exe" -ArgumentList "/c","pnpm --filter @r3mes/dapp dev" `
        -WorkingDirectory $Root -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $Logs "dapp.out.log") `
        -RedirectStandardError (Join-Path $Logs "dapp.err.log") | Out-Null
    }
    Start-Sleep -Seconds 8

    pnpm --filter "@r3mes/backend-api" lora:scale 0 0
    Show-Status
  } finally {
    Pop-Location
  }
}

function Stop-System {
  $ports = @(3000, 3001, 8000, 8080)
  $procIds = @(Get-ListenProcessIds $ports)
  foreach ($procId in $procIds) {
    if ($procId) {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Seconds 3
  docker stop r3mes-storage-gateway r3mes-qdrant r3mes-redis-cache r3mes-ipfs r3mes-postgres 2>$null | Out-Null
  Show-Status
}

switch ($Action) {
  "start" { Start-System }
  "stop" { Stop-System }
  "status" { Show-Status }
}
