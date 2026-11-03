# One-click start for Retinitry (Windows). Double-click START_RETINITRY.bat, or run:
#   powershell -ExecutionPolicy Bypass -File scripts\start.ps1
# First run: finds Python 3.11, creates .venv with the runtime packages (no GPU / PyTorch needed),
# rebuilds the model files from server\models\parts, then starts the server and opens the browser.
# Later runs skip what is already done. Everything stays on this machine. Ctrl+C or close the window to stop.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$url = "http://127.0.0.1:8765"
$py = Join-Path $root ".venv\Scripts\python.exe"
New-Item -ItemType Directory -Force (Join-Path $root "logs") | Out-Null

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

# 1. Python environment
if (-not (Test-Path $py)) {
    Step "Setting up Python (first run only, about 2-5 minutes)"
    $base = $null
    foreach ($cand in @(@("py", "-3.11"), @("python"), @("python3"))) {
        try {
            $v = & $cand[0] @($cand[1..9] | Where-Object { $_ }) -c "import sys;print('%d.%d'%sys.version_info[:2])" 2>$null
            if ($v -match '^3\.(1[01]|12)$') { $base = $cand; break }
        } catch {}
    }
    if (-not $base) {
        Write-Host "Python 3.11 was not found. Install it, then run this again:" -ForegroundColor Red
        Write-Host "  winget install Python.Python.3.11     (or https://www.python.org/downloads/release/python-3119/)"
        Read-Host "Press Enter to close"; exit 1
    }
    & $base[0] @($base[1..9] | Where-Object { $_ }) -m venv (Join-Path $root ".venv")
    & $py -m pip install --upgrade pip --quiet
    & $py -m pip install -r (Join-Path $root "requirements-runtime.txt")
    if ($LASTEXITCODE -ne 0) { Write-Host "Package install failed (see above)." -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }
}

# 2. Models (rebuilt from git-sized parts, hash-checked)
Step "Checking model files"
& $py (Join-Path $root "scripts\models.py") assemble
if ($LASTEXITCODE -ne 0) { Write-Host "Model files are missing or corrupt. Re-clone the repository or see docs\handoff\04_RUNBOOK.md." -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }

# 3. Web app (prebuilt web\dist is in git; rebuild only if it is missing and npm exists)
if (-not (Test-Path (Join-Path $root "web\dist\index.html"))) {
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Step "Building the web app"
        npm --prefix web ci; npm --prefix web run build
    } else {
        Write-Host "web\dist is missing and Node.js is not installed; the page will say the UI is not built." -ForegroundColor Yellow
    }
}

# 4. Server
Step "Starting Retinitry on $url"
$server = Start-Process -FilePath $py -ArgumentList @("-m", "uvicorn", "server.app.main:app", "--host", "127.0.0.1", "--port", "8765") `
    -WorkingDirectory $root -NoNewWindow -PassThru
try {
    $ready = $false
    for ($i = 0; $i -lt 180 -and -not $server.HasExited; $i++) {
        try { Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2 | Out-Null; $ready = $true; break } catch { Start-Sleep -Milliseconds 500 }
    }
    if ($ready) {
        Start-Process $url
        Write-Host "`nRetinitry is running at $url  (close this window or press Ctrl+C to stop)" -ForegroundColor Green
    } elseif ($server.HasExited) {
        Write-Host "Server exited with code $($server.ExitCode)." -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1
    } else {
        Write-Host "Server did not answer within 90 s; still waiting." -ForegroundColor Yellow
    }
    Wait-Process -Id $server.Id
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
