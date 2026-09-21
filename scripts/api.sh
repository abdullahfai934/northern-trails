#!/usr/bin/env bash
# Start (or restart) the Northern Trails API on :8000.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8000}"
LOG="${LOG:-$ROOT/.api.log}"

# Free the port, but only the process actually bound to it.
pid=$(ss -ltnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p {print $NF}' | grep -oP '(?<=pid=)\d+' | head -1 || true)
if [ -n "${pid:-}" ]; then
  echo "stopping pid $pid on :$PORT"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 20); do ss -ltn | grep -q ":$PORT " || break; sleep 0.25; done
fi

cd "$ROOT"
nohup backend/.venv/bin/python -m uvicorn app.main:app \
  --host 127.0.0.1 --port "$PORT" --app-dir backend > "$LOG" 2>&1 &
echo $! > "$ROOT/.api.pid"

for _ in $(seq 40); do
  curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && { echo "API up on :$PORT (pid $(cat "$ROOT/.api.pid"))"; exit 0; }
  sleep 0.25
done
echo "API failed to start — last log lines:"; tail -20 "$LOG"; exit 1
