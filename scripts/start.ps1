# Starts Retinitry: builds the web app if needed, runs the local server on http://127.0.0.1:8765
# and opens the browser. Everything stays on this machine. Press Ctrl+C to stop.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$py = Join-Path $root ".venv\Scripts\python.exe"
$url = "http://127.0.0.1:8765"

if (-not (Test-Path $py)) {
    Write-Host "Python environment not found at $py. Run scripts\setup_env.ps1 first." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path (Join-Path $root "web\dist\index.html"))) {
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Write-Host "Building the web app (web\dist missing)..."
        npm --prefix web ci
        if ($LASTEXITCODE -ne 0) { Write-Host "npm ci failed" -ForegroundColor Red; exit 1 }
        npm --prefix web run build
        if ($LASTEXITCODE -ne 0) { Write-Host "web build failed" -ForegroundColor Red; exit 1 }
    } else {
        Write-Host "web\dist is missing and npm is not installed; the server will show a 'UI not built' page." -ForegroundColor Yellow
    }
}

Write-Host "Starting Retinitry server on $url"
$server = Start-Process -FilePath $py -ArgumentList @("-m", "uvicorn", "server.app.main:app", "--host", "127.0.0.1", "--port", "8765") `
    -WorkingDirectory $root -NoNewWindow -PassThru

try {
    $ready = $false
    for ($i = 0; $i -lt 120 -and -not $server.HasExited; $i++) {
        try {
            Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2 | Out-Null
            $ready = $true
            break
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if ($ready) {
        Start-Process $url
        Write-Host "Retinitry is running at $url (Ctrl+C to stop)."
    } elseif ($server.HasExited) {
        Write-Host "Server exited with code $($server.ExitCode)." -ForegroundColor Red
        exit 1
    } else {
        Write-Host "Server did not answer on $url/api/health within 60 s; still waiting on it." -ForegroundColor Yellow
    }
    Wait-Process -Id $server.Id
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
