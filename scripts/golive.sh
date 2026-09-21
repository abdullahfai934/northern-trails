#!/usr/bin/env bash
# Put the whole app online: local backend -> public tunnel -> deployed SPA.
#
# Firebase Hosting serves static files only, so the FastAPI backend has to
# live somewhere else. With no billing on the GCP project (Cloud Run needs
# it) and no third-party host account, a Cloudflare quick tunnel is the
# way to give the deployed SPA a real API to talk to.
#
# The trade-off, stated plainly: the tunnel only lives as long as this
# machine and this process do, and its hostname changes on every restart —
# which is why the SPA has to be rebuilt and redeployed each time. For a
# permanent URL, deploy the Docker image to Render (see render.yaml) and
# set VITE_API_BASE to that instead.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SITE="${SITE:-https://northern-trails-fyp.web.app}"
PROJECT="${FIREBASE_PROJECT:-northern-trails-fyp}"
CF="${CF:-$HOME/.local/bin/cloudflared}"

command -v "$CF" >/dev/null 2>&1 || [ -x "$CF" ] || {
  echo "cloudflared not found at $CF"; exit 1; }

echo "==> 1/4  backend"
curl -sf http://127.0.0.1:8000/api/health >/dev/null 2>&1 \
  || { ./scripts/api.sh; }

echo "==> 2/4  public tunnel"
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 2
rm -f .tunnel.log .tunnel.url
setsid nohup "$CF" tunnel --url http://127.0.0.1:8000 \
  --no-autoupdate --edge-ip-version 4 > .tunnel.log 2>&1 < /dev/null &

URL=""
for _ in $(seq 25); do
  sleep 3
  URL=$(grep -oE "https://[a-z0-9][a-z0-9-]+\.trycloudflare\.com" .tunnel.log 2>/dev/null \
        | grep -v '//api\.' | head -1 || true)
  [ -n "$URL" ] && break
done
[ -n "$URL" ] || { echo "tunnel failed to start:"; tail -5 .tunnel.log; exit 1; }
echo "$URL" > .tunnel.url
echo "    $URL"

echo "==> 3/4  build SPA against it"
( cd frontend && VITE_API_BASE="$URL" VITE_FIREBASE_AUTH_EMULATOR_HOST= npm run build >/dev/null )

echo "==> 4/4  deploy"
firebase deploy --only hosting --project "$PROJECT" >/dev/null
echo
echo "    live: $SITE"
echo "    api : $URL/api/docs"
echo
echo "Leave this machine and the tunnel running for the site to stay live."
