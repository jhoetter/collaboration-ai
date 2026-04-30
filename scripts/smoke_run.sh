#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRET="${HOF_SUBAPP_JWT_SECRET:-dev-only-not-for-prod-9c2f}"
PORT="${COLLABAI_SMOKE_PORT:-18010}"
PROJECT="collabai-smoke-$RANDOM"
COMPOSE_FILE="$(mktemp -t collabai-smoke-compose.XXXXXX.yml)"
COOKIE_JAR="$(mktemp -t collabai-smoke-cookies.XXXXXX)"

cleanup() {
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$COMPOSE_FILE" "$COOKIE_JAR"
}
trap cleanup EXIT

cat >"$COMPOSE_FILE" <<EOF
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: hofos
      POSTGRES_PASSWORD: hofos
      POSTGRES_DB: collabai
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hofos -d collabai"]
      interval: 2s
      timeout: 2s
      retries: 20

  collabai:
    build:
      context: "$ROOT_DIR"
      dockerfile: Dockerfile.subapp
    ports:
      - "$PORT:8300"
    environment:
      DATABASE_URL: postgresql://hofos:hofos@postgres:5432/collabai
      HOF_SUBAPP_JWT_SECRET: "$SECRET"
      HOF_SUBAPP_NAME: collabai
      HOF_ENV: dev
    depends_on:
      postgres:
        condition: service_healthy
EOF

mint_jwt() {
  python3 - "$SECRET" <<'PY'
import base64
import hashlib
import hmac
import json
import sys
import time

secret = sys.argv[1].encode()

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")

header = {"alg": "HS256", "typ": "JWT"}
payload = {
    "aud": "collabai",
    "sub": "smoke-user",
    "tid": "smoke-tenant",
    "email": "smoke@example.test",
    "displayName": "Smoke User",
    "exp": int(time.time()) + 120,
}
h = b64url(json.dumps(header, separators=(",", ":")).encode())
p = b64url(json.dumps(payload, separators=(",", ":")).encode())
s = b64url(hmac.new(secret, f"{h}.{p}".encode("ascii"), hashlib.sha256).digest())
print(f"{h}.{p}.{s}")
PY
}

docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d --build

echo "Waiting for CollaborationAI on :$PORT..."
for _ in $(seq 1 90); do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS "http://localhost:$PORT/api/health" >/dev/null

TOKEN="$(mint_jwt)"
curl -fsS -D - -o /dev/null -c "$COOKIE_JAR" \
  "http://localhost:$PORT/?__hof_jwt=$TOKEN" | grep -qi "set-cookie: hof_subapp_session="

curl -fsS -b "$COOKIE_JAR" "http://localhost:$PORT/" | grep -qi "<html"

curl -fsS -b "$COOKIE_JAR" \
  -H "content-type: application/json" \
  -d '{"workspace_id":"smoke-tenant"}' \
  "http://localhost:$PORT/api/functions/users:list" >/dev/null

echo "CollaborationAI smoke passed: /api/health, /, SSO handoff, users:list"
