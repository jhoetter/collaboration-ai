# Backend image for the collaboration-ai sidecar deployed by hof-os.
# Mirrors the slim, single-stage shape of office-ai's sandbox image.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_LINK_MODE=copy

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*

COPY app /app
# `--no-sources` ignores hof-engine's `[tool.uv.sources]` override
# that points `llm-markdown` at a sibling `../llm-markdown` checkout
# (only present in the hof-engine dev tree). Without this flag uv
# rewrites the dep into `git+...#subdirectory=../llm-markdown`, which
# of course doesn't exist on PyPI/GHCR. We want PyPI's published
# `llm-markdown[openai,anthropic]` instead.
RUN uv pip install --system --no-sources -e .

EXPOSE 8300
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD curl -fsS http://localhost:8300/healthz || exit 1
CMD ["uvicorn", "hof.api.server:create_app", "--factory", "--host", "0.0.0.0", "--port", "8300"]
