#!/usr/bin/env python3
"""Deploy the API to a free Hugging Face Docker Space.

    HF_TOKEN=hf_xxx backend/.venv/bin/python scripts/deploy_hf.py

1. Creates (or reuses) the Space  <your-username>/northern-trails-api
2. Uploads the backend, Dockerfile and a Space README (port 8000)
3. Sets every secret from .env — database, Gemini, Firebase service account,
   admin settings — as Space secrets (never committed anywhere)
4. Waits for the build and prints the API URL; then run
       ./scripts/deploy-web.sh <that URL>
   to point the Firebase site at it.

Needs `pip install huggingface_hub` (deploy-time only, not an app dependency).
"""
import os
import pathlib
import shutil
import sys
import tempfile
import time
import urllib.request

from huggingface_hub import HfApi

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPACE_NAME = os.environ.get("HF_SPACE", "northern-trails-api")
SITE = os.environ.get("SITE_URL", "https://northern-trails-fyp.web.app")

token = os.environ.get("HF_TOKEN", "").strip()
if not token:
    sys.exit("Set HF_TOKEN to a Hugging Face access token with write permission.")


def read_env() -> dict:
    env = {}
    for line in (ROOT / ".env").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"')
    return env


env = read_env()
api = HfApi(token=token)
user = api.whoami()["name"]
repo_id = f"{user}/{SPACE_NAME}"
api.create_repo(repo_id, repo_type="space", space_sdk="docker", exist_ok=True, private=False)
print(f"space: https://huggingface.co/spaces/{repo_id}")

# ---- files: the backend + Docker build, and the Space card
with tempfile.TemporaryDirectory() as tmp:
    out = pathlib.Path(tmp)
    shutil.copytree(ROOT / "backend", out / "backend",
                    ignore=shutil.ignore_patterns(".venv", "__pycache__", ".cache", ".pytest_cache", "tests"))
    shutil.copytree(ROOT / "frontend", out / "frontend",
                    ignore=shutil.ignore_patterns("node_modules", "dist", ".vite"))
    shutil.copy(ROOT / "Dockerfile", out / "Dockerfile")
    (out / "README.md").write_text(
        "---\ntitle: Northern Trails API\nemoji: 🏔️\ncolorFrom: blue\ncolorTo: yellow\n"
        "sdk: docker\napp_port: 8000\npinned: false\n---\n\n"
        "Backend API for [Northern Trails](" + SITE + ") — tours, live conditions and a grounded AI "
        "assistant for Gilgit-Baltistan and Chitral. Docs at `/api/docs`.\n")
    api.upload_folder(folder_path=str(out), repo_id=repo_id, repo_type="space",
                      commit_message="Deploy Northern Trails API")
print("uploaded")

# ---- secrets and variables
sa_path = env.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")
sa_json = (ROOT / sa_path).read_text() if sa_path and not sa_path.startswith("{") else sa_path
secrets = {
    "DATABASE_URL": env.get("DATABASE_URL", ""),
    "GEMINI_API_KEY": env.get("GEMINI_API_KEY", ""),
    "GOOGLE_SERVICE_ACCOUNT_JSON": sa_json,
    "ADMIN_TOKEN": env.get("ADMIN_TOKEN", ""),
    "OPENWEATHER_API_KEY": env.get("OPENWEATHER_API_KEY", ""),
    "UNSPLASH_ACCESS_KEY": env.get("UNSPLASH_ACCESS_KEY", ""),
    "GOOGLE_PLACES_API_KEY": env.get("GOOGLE_PLACES_API_KEY", ""),
    "SMTP_HOST": env.get("SMTP_HOST", ""), "SMTP_USER": env.get("SMTP_USER", ""),
    "SMTP_PASSWORD": env.get("SMTP_PASSWORD", ""),
}
variables = {
    "GEMINI_MODEL": env.get("GEMINI_MODEL", "gemini-3.6-flash"),
    "FIREBASE_PROJECT_ID": env.get("FIREBASE_PROJECT_ID", ""),
    "ADMIN_EMAILS": env.get("ADMIN_EMAILS", ""),
    "CORS_ORIGINS": f"{SITE},https://northern-trails-fyp.firebaseapp.com,http://localhost:5173",
    "PAYMENTS_PROVIDER": "mock",
    "PAYMENTS_RETURN_URL": f"{SITE}/pay/return",
    "SITE_URL": SITE,
    "POLL_ENABLED": "1", "LOOKUPS_ENABLED": "1", "ALERTS_ENABLED": "1",
}
for k, v in secrets.items():
    if v:
        api.add_space_secret(repo_id, k, v)
for k, v in variables.items():
    if v:
        api.add_space_variable(repo_id, k, v)
print("secrets set:", ", ".join(k for k, v in secrets.items() if v))
api.restart_space(repo_id)

# ---- wait for it to come up
host = api.space_info(repo_id).host or f"https://{user}-{SPACE_NAME}.hf.space".lower().replace("_", "-")
print("building… (the first Docker build takes a few minutes)")
for i in range(90):
    time.sleep(20)
    stage = api.get_space_runtime(repo_id).stage
    try:
        with urllib.request.urlopen(host + "/api/health", timeout=20) as r:
            if r.status == 200:
                print(f"\nlive: {host}/api/health")
                print(f"next: ./scripts/deploy-web.sh {host}")
                sys.exit(0)
    except Exception:
        pass
    print(f"  {stage}", flush=True)
    if stage in ("BUILD_ERROR", "RUNTIME_ERROR", "CONFIG_ERROR"):
        sys.exit(f"Space failed: {stage}. See the logs at https://huggingface.co/spaces/{repo_id}")
sys.exit("Timed out waiting for the Space — check its logs on Hugging Face.")
