#!/usr/bin/env bash
# Start the Firebase Auth emulator on :9099 (UI on :4000).
#
# This runs the real Firebase Auth software locally: the full phone-OTP flow
# works with no SMS, no billing and no console setup. Codes are not texted —
# read them from the Emulator UI, or from
#   curl localhost:9099/emulator/v1/projects/$PROJECT/verificationCodes
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="${FIREBASE_PROJECT:-northern-trails-fyp}"
LOG="${LOG:-$ROOT/.emulator.log}"

pid=$(ss -ltnp 2>/dev/null | awk '$4 ~ /:9099$/ {print $NF}' | grep -oP '(?<=pid=)\d+' | head -1 || true)
if [ -n "${pid:-}" ]; then
  echo "stopping emulator pid $pid on :9099"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 20); do ss -ltn | grep -q ':9099 ' || break; sleep 0.5; done
fi

cd "$ROOT"
nohup firebase emulators:start --only auth --project "$PROJECT" > "$LOG" 2>&1 &
echo $! > "$ROOT/.emulator.pid"

for _ in $(seq 60); do
  curl -sf "http://127.0.0.1:9099/" >/dev/null 2>&1 && {
    echo "Auth emulator up on :9099 (UI http://localhost:4000/auth)"; exit 0; }
  sleep 0.5
done
echo "emulator failed to start — last log lines:"; tail -25 "$LOG"; exit 1
