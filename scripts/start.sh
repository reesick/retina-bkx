#!/usr/bin/env bash
# Starts Retinitry: builds the web app if needed, runs the local server on http://127.0.0.1:8765
# and opens the browser. Everything stays on this machine. Press Ctrl+C to stop.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
URL="http://127.0.0.1:8765"

if [ -x "$ROOT/.venv/bin/python" ]; then PY="$ROOT/.venv/bin/python"
elif [ -x "$ROOT/.venv/Scripts/python.exe" ]; then PY="$ROOT/.venv/Scripts/python.exe"
else
  echo "First run: creating .venv with the runtime packages (no GPU needed)..."
  BASE="$(command -v python3.11 || command -v python3 || true)"
  [ -n "$BASE" ] || { echo "Python 3.11 not found. Install it and re-run." >&2; exit 1; }
  "$BASE" -m venv "$ROOT/.venv"
  PY="$ROOT/.venv/bin/python"
  "$PY" -m pip install --upgrade pip --quiet
  "$PY" -m pip install -r "$ROOT/requirements-runtime.txt"
fi

"$PY" "$ROOT/scripts/models.py" assemble || { echo "Model files missing or corrupt." >&2; exit 1; }

if [ ! -f "$ROOT/web/dist/index.html" ]; then
  if command -v npm >/dev/null 2>&1; then
    echo "Building the web app (web/dist missing)..."
    npm --prefix web ci
    npm --prefix web run build
  else
    echo "web/dist is missing and npm is not installed; the server will show a 'UI not built' page." >&2
  fi
fi

echo "Starting Retinitry server on $URL"
"$PY" -m uvicorn server.app.main:app --host 127.0.0.1 --port 8765 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 120); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then echo "Server exited." >&2; exit 1; fi
  if curl -fsS "$URL/api/health" >/dev/null 2>&1; then
    if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
    elif command -v open >/dev/null 2>&1; then open "$URL" || true
    fi
    echo "Retinitry is running at $URL (Ctrl+C to stop)."
    break
  fi
  sleep 0.5
done

wait "$SERVER_PID"
