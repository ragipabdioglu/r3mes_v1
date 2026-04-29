$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class ShortPath {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern uint GetShortPathName(string lpszLongPath, StringBuilder lpszShortPath, uint cchBuffer);
}
"@

function Get-ShortPath([string]$Path) {
  $sb = New-Object System.Text.StringBuilder 1024
  $len = [ShortPath]::GetShortPathName($Path, $sb, [uint32]$sb.Capacity)
  if ($len -gt 0) { return $sb.ToString() }
  return $Path
}

$root = Get-ShortPath (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..\..")).Path
$cacheRoot = "C:\r3mes-train-cache\doctor-role-qwen3b-v1"
$bin = Get-ShortPath "$root\infrastructure\llama-runtime\win-vulkan-x64\llama-finetune-lora.exe"
$model = "C:\r3mes-model-cache\qwen2.5-3b-instruct-q5_k_m.gguf"
$sourceTrain = "$root\infrastructure\lora-trials\candidates\2026-04-23_doctor-role-qwen3b-v1\train\doctor-role-qwen3b-v1-train.jsonl"
$repoOutDir = "$root\infrastructure\lora-trials\candidates\2026-04-23_doctor-role-qwen3b-v1\export"
$repoOut = "$repoOutDir\doctor-role-qwen3b-v1.gguf"
$data = Get-ShortPath "$cacheRoot\doctor-role-qwen3b-v1-train.jsonl"
$outDir = Get-ShortPath $cacheRoot
$ckptDir = Get-ShortPath "$cacheRoot\checkpoints"
$out = "$outDir\doctor-role-qwen3b-v1.gguf"

New-Item -ItemType Directory -Force -Path $repoOutDir | Out-Null
New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
New-Item -ItemType Directory -Force -Path "$cacheRoot\checkpoints" | Out-Null
Copy-Item -LiteralPath $sourceTrain -Destination "$cacheRoot\doctor-role-qwen3b-v1-train.jsonl" -Force

Write-Host "Binary: $bin"
Write-Host "Model:  $model"
Write-Host "Data:   $data"
Write-Host "Output: $out"

& $bin `
  --model $model `
  --file $data `
  --assistant-loss-only `
  --output-adapter $out `
  --num-epochs 2 `
  --lora-rank 8 --lora-alpha 16 --lora-modules attn_q,attn_v `
  -ngl 999 -c 384 -b 4 -ub 4 `
  --flash-attn off `
  --learning-rate 1.5e-4 --lr-min 1e-6 `
  --lr-scheduler cosine --warmup-ratio 0.03 `
  --checkpoint-save-steps 200 `
  --checkpoint-save-dir $ckptDir

$code = $LASTEXITCODE
if ($code -eq 0 -and (Test-Path -LiteralPath $out)) {
  Copy-Item -LiteralPath $out -Destination $repoOut -Force
}
Write-Host "EXIT_CODE=$code"
exit $code
