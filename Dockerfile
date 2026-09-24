# ---- stage 1: build the React app -------------------------------------
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- stage 2: API + built SPA -----------------------------------------
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 NT_CACHE_DIR=/tmp/nt-cache
WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
COPY --from=web /web/dist ./frontend/dist

EXPOSE 8000
# FastAPI serves /api, /ws and the built SPA from the same origin.
CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --app-dir backend"]
