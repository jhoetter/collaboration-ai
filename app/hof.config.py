"""Top-level hof-engine configuration for the collaboration-ai backend.

Discovery roots:
- Tables / @function endpoints live under ``domain/<entity>/{table,functions}.py``;
  shim re-exports under ``tables/`` and ``functions/`` keep hof-engine's
  filesystem-based discovery happy.
- Vite + React UI under ``ui/`` is served by hof-engine's Vite manager.
"""

from __future__ import annotations

import os

from hof import Config

config = Config(
    app_name="collabai",
    database_url=os.environ.get("DATABASE_URL", "postgresql+psycopg://collabai:collabai@localhost:5434/collabai"),
    redis_url=os.environ.get("REDIS_URL", "redis://localhost:6381/0"),
    agent_reasoning_mode="fallback",
    docs_dir="docs",
)
