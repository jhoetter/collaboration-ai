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

.PHONY: help install dev dev-api dev-web kill-ports \
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

install:
	$(PNPM) install
	cd $(APP_DIR) && $(PYTHON) -m venv .venv && .venv/bin/pip install --upgrade pip && .venv/bin/pip install -e ".[dev]"
	cd cli/collabai && $(PYTHON) -m venv .venv && .venv/bin/pip install --upgrade pip && .venv/bin/pip install -e ".[dev]"

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

# Frees ports we own before spinning back up — matches hof-os's
# `kill-ports` so re-running `make dev` after a Ctrl-C doesn't trip
# "address already in use".
kill-ports:
	@lsof -ti :$(API_PORT) | xargs kill -9 2>/dev/null || true
	@lsof -ti :$(WEB_PORT) | xargs kill -9 2>/dev/null || true

dev: db-up kill-ports
	@echo "→ API   http://localhost:$(API_PORT)"
	@echo "→ Web   http://localhost:$(WEB_PORT)"
	$(PNPM) -w exec concurrently -k -n api,web -c blue,magenta \
	  "$(MAKE) dev-api" \
	  "$(MAKE) dev-web"

dev-api:
	cd $(APP_DIR) && .venv/bin/hof dev --no-ui --port $(API_PORT)

dev-web:
	$(PNPM) --filter @collabai/web dev --port $(WEB_PORT) --strictPort

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
