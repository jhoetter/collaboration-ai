# collaboration-ai monorepo Makefile.
# Mirrors the office-ai / hof-os shape (`make verify` is the merge gate).

PYTHON ?= python3.13
APP_DIR := app
PNPM := pnpm

# Local "AI suite" port allocation:
#   3000 -> hof-os         (8000 backend)
#   3100 -> office-ai      (8100 backend)
#   3200 -> mail-ai        (8200 backend, reserved)
#   3300 -> collaboration  (8300 backend)  <-- this repo
WEB_PORT ?= 3300
API_PORT ?= 8300

.PHONY: help install dev dev-api dev-web kill-ports seed \
        db-up db-down db-reset db-logs \
        dev-stack dev-stack-down compose-up compose-down compose-logs \
        test test-py test-js format format-check lint architecture \
        typecheck verify build clean

help:
	@echo "Targets:"
	@echo "  install      Install JS + Python dependencies"
	@echo "  dev          Bring up infra + backend (:$(API_PORT)) + web UI (:$(WEB_PORT)) — one command"
	@echo "  dev-api      Backend only on :$(API_PORT) (assumes db-up has run)"
	@echo "  dev-web      Web UI only on :$(WEB_PORT)"
	@echo "  seed         Populate the demo workspace, channels, agent + proposals (idempotent)"
	@echo "  db-up        Start postgres / redis / minio / mailhog (== old dev-stack)"
	@echo "  db-down      Stop the dev infra"
	@echo "  db-reset     Wipe volumes and recreate the dev infra"
	@echo "  db-logs      Tail dev-infra container logs"
	@echo "  test         Run the full test suite"
	@echo "  test-py      Run Python tests only"
	@echo "  test-js      Run JS tests only"
	@echo "  format       Format JS + Python sources"
	@echo "  lint         Lint everything (eslint + ruff)"
	@echo "  architecture Run the package-DAG guard"
	@echo "  typecheck    Typecheck JS packages + mypy app/"
	@echo "  verify       The merge gate — runs format-check, lint, architecture, typecheck, test, build"
	@echo "  build        Build all distributable artefacts"
	@echo "  clean        Remove build outputs and venvs"

# If `~/repos/hof-engine` exists we prefer an editable install of the
# sibling checkout so backend hacking can stay local-first (matches
# the office-ai sibling-fallback pattern in
# ensure-collabai-react-embeds.cjs). Otherwise pyproject.toml's
# `hof-engine @ git+...` pin pulls main from GitHub — same source
# hof-os/backend uses.
HOF_ENGINE_LOCAL := $(HOME)/repos/hof-engine

install:
	$(PNPM) install
	cd $(APP_DIR) && $(PYTHON) -m venv .venv && .venv/bin/pip install --upgrade pip && .venv/bin/pip install -e ".[dev]"
	@if [ -d "$(HOF_ENGINE_LOCAL)" ]; then \
	  echo "→ overlaying editable hof-engine from $(HOF_ENGINE_LOCAL)"; \
	  $(APP_DIR)/.venv/bin/pip install -e "$(HOF_ENGINE_LOCAL)"; \
	fi

# Mirrors hof-os/Makefile naming (db-up / db-down / db-reset). Old
# dev-stack* / compose-* targets stay as aliases so existing muscle
# memory and CI scripts keep working.
db-up:
	docker compose -f infra/docker-compose.yml up -d
	@echo ""
	@echo "Postgres: localhost:5434  Redis: localhost:6381  MinIO: http://localhost:9101  Mailhog: http://localhost:8026"

db-down:
	docker compose -f infra/docker-compose.yml down

db-reset:
	docker compose -f infra/docker-compose.yml down -v
	$(MAKE) db-up

db-logs:
	docker compose -f infra/docker-compose.yml logs -f --tail=100

dev-stack: db-up
dev-stack-down: db-down
compose-up: db-up
compose-down: db-down
compose-logs: db-logs

# Frees the ports we own before spinning back up. Mirrors mail-ai /
# office-ai: a naive `lsof | kill` loses to vite / next / concurrently
# because (a) they spawn workers that hold the port even after the
# parent dies, and (b) there's a tiny window between kill and the next
# bind where the supervisor can respawn. So we do:
#   1. kill any process holding the port
#   2. pkill the supervisors that match this workspace (so we don't
#      whack mail-ai / office-ai / hof-os running side-by-side)
#   3. poll until the ports are really free (max ~3s)
# Re-running `make dev` from any state Just Works.
kill-ports:
	@PORTS="$(API_PORT) $(WEB_PORT)"; \
	WS_TAG="$(CURDIR)"; \
	for _ in 1 2 3 4 5 6; do \
	  for p in $$PORTS; do \
	    pids=$$(lsof -ti :$$p 2>/dev/null); \
	    [ -n "$$pids" ] && kill -9 $$pids 2>/dev/null || true; \
	  done; \
	  pkill -9 -f "vite.*$$WS_TAG"        2>/dev/null || true; \
	  pkill -9 -f "next-server.*$$WS_TAG" 2>/dev/null || true; \
	  pkill -9 -f "next dev.*$$WS_TAG"    2>/dev/null || true; \
	  pkill -9 -f "uvicorn.*$$WS_TAG"     2>/dev/null || true; \
	  pkill -9 -f "concurrently.*$$WS_TAG" 2>/dev/null || true; \
	  pkill -9 -f "turbo run dev"         2>/dev/null || true; \
	  busy=""; \
	  for p in $$PORTS; do \
	    lsof -ti :$$p >/dev/null 2>&1 && busy="$$busy $$p"; \
	  done; \
	  [ -z "$$busy" ] && exit 0; \
	  sleep 0.5; \
	done; \
	echo "kill-ports: still in use after retries:$$busy" >&2; \
	exit 1

dev: db-up kill-ports
	@echo "→ API   http://localhost:$(API_PORT)"
	@echo "→ Web   http://localhost:$(WEB_PORT)"
	$(PNPM) -w exec concurrently -k -n api,web -c blue,magenta \
	  "$(MAKE) dev-api" \
	  "$(MAKE) dev-web"

dev-api:
	@# Python 3.13's sqlite-backed dbm corrupts the celery beat shelf if
	@# the previous run left a stale WAL behind, which floods the dev
	@# console with `dbm.sqlite3.error: disk I/O error`. Nuking the
	@# scheduler state at startup is safe — beat reseeds it from the
	@# tasks registered in code.
	@cd $(APP_DIR) && rm -f celerybeat-schedule celerybeat-schedule-shm celerybeat-schedule-wal celerybeat.pid
	cd $(APP_DIR) && .venv/bin/hof dev --no-ui --port $(API_PORT)

dev-web:
	$(PNPM) --filter @collabai/web dev --port $(WEB_PORT) --strictPort

seed: db-up
	cd $(APP_DIR) && .venv/bin/hof db migrate
	cd $(APP_DIR) && .venv/bin/python -m scripts.seed

test: test-py test-js

test-py:
	cd $(APP_DIR) && .venv/bin/python -m pytest tests/

test-js:
	$(PNPM) -w turbo test

format:
	$(PNPM) -w prettier --write "**/*.{ts,tsx,js,jsx,json,md,yml,yaml}"
	cd $(APP_DIR) && .venv/bin/ruff format domain tests || true

format-check:
	$(PNPM) -w prettier --check "**/*.{ts,tsx,js,jsx,json,md,yml,yaml}"
	cd $(APP_DIR) && .venv/bin/ruff format --check domain tests || true

lint:
	$(PNPM) -w eslint "packages/**/*.{ts,tsx}"
	cd $(APP_DIR) && .venv/bin/ruff check domain tests

architecture:
	node scripts/check-architecture.mjs

typecheck:
	$(PNPM) -w turbo typecheck
	cd $(APP_DIR) && .venv/bin/python -m mypy domain || true

build:
	$(PNPM) -w turbo build

verify: format-check lint architecture typecheck test build
	@echo "verify: PASS"

clean:
	$(PNPM) -w turbo clean || true
	rm -rf node_modules **/node_modules **/dist **/.turbo
	rm -rf $(APP_DIR)/.venv $(APP_DIR)/.pytest_cache $(APP_DIR)/.ruff_cache
