#!/usr/bin/env bash
# Start (or restart) the Vite dev server on :5173.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-5173}"
LOG="${LOG:-$ROOT/.web.log}"

pid=$(ss -ltnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p {print $NF}' | grep -oP '(?<=pid=)\d+' | head -1 || true)
[ -n "${pid:-}" ] && { kill "$pid" 2>/dev/null || true; sleep 1; }

cd "$ROOT/frontend"
nohup npm run dev -- --port "$PORT" > "$LOG" 2>&1 &
echo $! > "$ROOT/.web.pid"

for _ in $(seq 60); do
  curl -sf "http://127.0.0.1:$PORT/" >/dev/null && { echo "Web up on http://localhost:$PORT (pid $(cat "$ROOT/.web.pid"))"; exit 0; }
  sleep 0.5
done
echo "Vite failed to start — last log lines:"; tail -30 "$LOG"; exit 1
