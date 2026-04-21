# collaboration-ai monorepo Makefile.
# Mirrors the office-ai / hof-os shape (`make verify` is the merge gate).

PYTHON ?= python3.13
APP_DIR := app
PNPM := pnpm

.PHONY: help install dev dev-stack dev-stack-down test test-py test-js \
        format format-check lint architecture typecheck verify build clean \
        compose-up compose-down compose-logs

help:
	@echo "Targets:"
	@echo "  install      Install JS + Python dependencies"
	@echo "  dev-stack    Start the dev infra (postgres / redis / minio / mailhog)"
	@echo "  dev          Run the backend + UI dev servers (requires dev-stack)"
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

dev-stack compose-up:
	docker compose -f infra/docker-compose.yml up -d
	@echo ""
	@echo "Postgres: localhost:5434  Redis: localhost:6381  MinIO: http://localhost:9101  Mailhog: http://localhost:8026"

compose-down dev-stack-down:
	docker compose -f infra/docker-compose.yml down

compose-logs:
	docker compose -f infra/docker-compose.yml logs -f --tail=100

dev:
	$(PNPM) -w turbo dev

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
