# Resumable end-to-end training for Retinitry. Safe to stop (Ctrl+C / close window / reboot) and re-run:
#   - datasets: finished files are recorded in data/manifest.json and skipped
#   - training: every epoch writes runs/<model>/last.pt; a re-run continues from the last finished epoch
#   - finished stages (runs/<model>/done.txt, server/models/*.onnx, policy.json ...) are skipped
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\train.ps1
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$py = Join-Path $root ".venv\Scripts\python.exe"
New-Item -ItemType Directory -Force logs, d:\retina\.cache\tmp | Out-Null
$env:HF_HOME = "d:\retina\.cache\hf"
$env:TORCH_HOME = "d:\retina\.cache\torch"
$env:TMP = "d:\retina\.cache\tmp"; $env:TEMP = $env:TMP
$env:HF_HUB_DISABLE_XET = "1"
$env:PYTHONUNBUFFERED = "1"

Write-Host "== 1/2 datasets (resumes, skips finished) ==" -ForegroundColor Cyan
& $py -m ml.data.fetch 2>&1 | Tee-Object -Append logs\train_fetch.log

Write-Host "== 2/2 training, export, evaluation, demo cases (resumes per epoch) ==" -ForegroundColor Cyan
Write-Host "   per-stage logs: logs\stage_<name>.log" -ForegroundColor DarkGray
& $py -m ml.run_all 2>&1 | Tee-Object -Append logs\train_run_all.log

Write-Host "== status ==" -ForegroundColor Cyan
Get-ChildItem runs -Directory | ForEach-Object {
    $s = if (Test-Path "$($_.FullName)\done.txt") { "done" } elseif (Test-Path "$($_.FullName)\last.pt") { "partial (will resume)" } else { "not started" }
    "{0,-12} {1}" -f $_.Name, $s
}
Get-ChildItem server\models -ErrorAction SilentlyContinue | Select-Object Name, Length
