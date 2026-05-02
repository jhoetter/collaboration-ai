# Backend image for the collaboration-ai sidecar deployed by hof-os.
# Builds the same standalone artifact as Dockerfile.subapp: Vite SPA + API.
FROM node:20-bookworm-slim AS web-builder

ARG DESIGN_SYSTEM=conservative
ENV VITE_DESIGN_SYSTEM=${DESIGN_SYSTEM}

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY vendor ./vendor
COPY infra ./infra
COPY scripts ./scripts
COPY packages ./packages
RUN if [ -f vendor/hofos/use-local-hofos-packages.mjs ]; then \
      node vendor/hofos/use-local-hofos-packages.mjs \
      && pnpm install --no-frozen-lockfile --prefer-offline; \
    else \
      pnpm install --frozen-lockfile --prefer-offline; \
    fi
RUN pnpm --filter @collabai/web build

FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_LINK_MODE=copy \
    HOF_SUBAPP_NAME=collabai \
    HOF_SUBAPP_AUTH_MODE=inherit

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates git \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app

COPY app /app
# `--no-sources` ignores hof-engine's `[tool.uv.sources]` override
# that points `llm-markdown` at a sibling `../llm-markdown` checkout
# (only present in the hof-engine dev tree). Without this flag uv
# rewrites the dep into `git+...#subdirectory=../llm-markdown`, which
# of course doesn't exist on PyPI/GHCR. We want PyPI's published
# `llm-markdown[openai,anthropic]` instead.
RUN uv pip install --system --no-sources -e .
COPY --from=web-builder /workspace/packages/web/dist /app/web
COPY hof-module.json tools.json /app/
COPY cli/chat-agent /usr/local/bin/chat-agent
RUN chmod +x /usr/local/bin/chat-agent

EXPOSE 8300
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD curl -fsS http://localhost:8300/api/health || exit 1
CMD ["sh", "-c", "hof db migrate && exec uvicorn hof.api.server:create_app --factory --host 0.0.0.0 --port 8300"]
