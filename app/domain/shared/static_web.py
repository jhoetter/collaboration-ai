"""Static SPA mount for the standalone CollaborationAI subapp image."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger("collabai.static_web")

_RESERVED_PREFIXES = ("api/", "ws/", "health", "healthz", "readyz", "docs", "openapi.json")


def _candidate_dist_dirs() -> list[Path]:
    explicit = (os.environ.get("COLLABAI_WEB_DIST") or "").strip()
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit))
    candidates.append(Path("/app/web"))
    repo_root = Path(__file__).resolve().parents[3]
    candidates.append(repo_root / "packages" / "web" / "dist")
    return candidates


def _resolve_dist_dir() -> Path | None:
    for candidate in _candidate_dist_dirs():
        if (candidate / "index.html").is_file():
            return candidate
    return None


def mount_static_web(app: FastAPI) -> None:
    """Mount the built Vite SPA without stealing API/WS/health routes."""
    if getattr(app.state, "collabai_static_web_mounted", False):
        return
    dist_dir = _resolve_dist_dir()
    if dist_dir is None:
        logger.info("CollaborationAI web dist not found; serving API-only backend")
        return

    assets_dir = dist_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="collabai-assets")

    index_path = dist_dir / "index.html"

    @app.get("/", include_in_schema=False)
    async def collabai_index() -> FileResponse:
        return FileResponse(index_path)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def collabai_spa_fallback(full_path: str) -> FileResponse:
        normalized = full_path.lstrip("/")
        if normalized.startswith(_RESERVED_PREFIXES):
            raise HTTPException(status_code=404)
        file_path = dist_dir / normalized
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(index_path)

    app.state.collabai_static_web_mounted = True


__all__ = ["mount_static_web"]
