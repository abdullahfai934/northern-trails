#!/usr/bin/env bash
# Build the SPA against a permanent API and publish it to Firebase Hosting.
#
#   ./scripts/deploy-web.sh https://northern-trails-api.onrender.com
#
# Use this once the backend is deployed (render.yaml). Unlike golive.sh it
# needs nothing running on this machine afterwards: the site calls the
# hosted API directly.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API="${1:-${VITE_API_BASE:-}}"
API="${API%/}"
PROJECT="${FIREBASE_PROJECT:-northern-trails-fyp}"
[ -n "$API" ] || { echo "usage: $0 https://your-api.onrender.com"; exit 1; }

echo "==> checking $API/api/health (a sleeping free instance can take a minute to wake)"
curl -sf --max-time 120 "$API/api/health" >/dev/null \
  || { echo "    API did not answer at $API/api/health"; exit 1; }

if command -v firebase >/dev/null 2>&1; then FIREBASE="firebase"; else FIREBASE="npx --yes firebase-tools"; fi
# firebase-tools needs Node >= 20; prefer an nvm-installed one if the default is older.
if [ "$(node -pe 'process.versions.node.split(".")[0]')" -lt 20 ] 2>/dev/null; then
  NEWER=$(ls -1d "$HOME"/.nvm/versions/node/v2[0-9].* 2>/dev/null | sort -V | tail -1 || true)
  [ -n "${NEWER:-}" ] && export PATH="$NEWER/bin:$PATH"
fi

echo "==> building SPA against $API"
( cd frontend && VITE_API_BASE="$API" VITE_FIREBASE_AUTH_EMULATOR_HOST= npm run build >/dev/null )

echo "==> deploying to Firebase Hosting ($PROJECT)"
$FIREBASE deploy --only hosting --project "$PROJECT" >/dev/null
echo "    live: https://$PROJECT.web.app  (API: $API)"
