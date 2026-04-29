#!/usr/bin/env pwsh
# Tek temiz test öncesi: golden path portları ve çift süreç (farklı PID) uyarısı.
# Local Address içinde ":13000" gibi değerlerin ":3000" ile yanlış eşleşmesini önlemek için port sonek parse edilir.

$ErrorActionPreference = "Stop"
$ports = @(
    @{ Port = 3000; Name = "backend-api" }
    @{ Port = 3001; Name = "dApp" }
    @{ Port = 8000; Name = "ai-engine" }
    @{ Port = 8080; Name = "llama-server (BitNet)" }
    @{ Port = 9080; Name = "IPFS gateway" }
)

function Get-ListenPids([int] $port) {
    $pids = [System.Collections.Generic.HashSet[string]]::new()
    netstat -ano | ForEach-Object {
        $line = $_.Trim()
        if ($line -notmatch "^\S+\s+") { return }
        if ($line -notmatch "LISTENING") { return }
        $parts = $line -split "\s+" | Where-Object { $_ -ne "" }
        if ($parts.Count -lt 5) { return }
        # Proto, Local Address, Foreign, State, PID
        $local = $parts[1]
        $lastColon = $local.LastIndexOf(":")
        if ($lastColon -lt 0) { return }
        $localPort = $local.Substring($lastColon + 1)
        if (-not ($localPort -match "^\d+$")) { return }
        if ([int]$localPort -ne $port) { return }
        $pidStr = $parts[-1]
        if ($pidStr -match "^\d+$") {
            [void]$pids.Add($pidStr)
        }
    }
    return @($pids) | Sort-Object
}

$failed = $false
foreach ($p in $ports) {
    # Tek PID dondugunde scalar string olur; [0] ilk karaktere donusur — her zaman dizi sar.
    $listenPids = @(Get-ListenPids $p.Port)
    if ($listenPids.Count -eq 0) {
        Write-Host "[FAIL] $($p.Name) : port $($p.Port) dinlenmiyor" -ForegroundColor Red
        $failed = $true
    }
    elseif ($listenPids.Count -gt 1) {
        Write-Host "[WARN] $($p.Name) :$($p.Port) — birden fazla farkli PID: $($listenPids -join ', ') (esik surec?)" -ForegroundColor Yellow
    }
    else {
        Write-Host "[ OK ] $($p.Name) :$($p.Port) (PID $($listenPids[0]))" -ForegroundColor Green
    }
}

if ($failed) {
    Write-Host "`nBir veya daha fazla port kapali. Tek 'pnpm bootstrap' + tek 'pnpm dev' + tek llama (8080) ile yeniden deneyin." -ForegroundColor Yellow
    exit 1
}
exit 0
