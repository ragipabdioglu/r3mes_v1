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
  if ($len -gt 0) {
    return $sb.ToString()
  }
  return $Path
}

$bin = Get-ShortPath "C:\Users\rabdi\OneDrive\Masaüstü\R3MES\infrastructure\llama-runtime\win-cpu-x64\llama-finetune-lora.exe"
$model = Get-ShortPath "C:\Users\rabdi\OneDrive\Masaüstü\R3MES\infrastructure\docker\models\bitnet\1bitLLM-bitnet_b1_58-xl-tq2_0.gguf"
$data = Get-ShortPath "C:\Users\rabdi\OneDrive\Masaüstü\R3MES\infrastructure\lora-trials\candidates\2026-04-17_tr-v3\train\tr-conversations-v3.jsonl"
$outDir = Get-ShortPath "C:\Users\rabdi\OneDrive\Masaüstü\R3MES\infrastructure\lora-trials\candidates\2026-04-17_tr-v3\export"
$ckptDir = Get-ShortPath "C:\Users\rabdi\OneDrive\Masaüstü\R3MES\infrastructure\lora-trials\candidates\2026-04-17_tr-v3\train\checkpoints_fresh"
$out = "$outDir\tr-v3-fresh.gguf"

New-Item -ItemType Directory -Force -Path "C:\Users\rabdi\OneDrive\Masaüstü\R3MES\infrastructure\lora-trials\candidates\2026-04-17_tr-v3\export" | Out-Null
New-Item -ItemType Directory -Force -Path "C:\Users\rabdi\OneDrive\Masaüstü\R3MES\infrastructure\lora-trials\candidates\2026-04-17_tr-v3\train\checkpoints_fresh" | Out-Null

Write-Host "Binary: $bin"
Write-Host "Model:  $model"
Write-Host "Data:   $data"
Write-Host "Output: $out"

& $bin `
  --model $model `
  --file $data `
  --assistant-loss-only `
  --output-adapter $out `
  --num-epochs 24 `
  --lora-rank 16 --lora-alpha 32 --lora-modules all `
  -ngl 0 -c 128 -b 64 -ub 64 `
  --flash-attn off `
  --learning-rate 5e-5 --lr-min 1e-6 `
  --lr-scheduler cosine --warmup-ratio 0.05 `
  --checkpoint-save-steps 100 `
  --checkpoint-save-dir $ckptDir

$code = $LASTEXITCODE
Write-Host "EXIT_CODE=$code"
exit $code
