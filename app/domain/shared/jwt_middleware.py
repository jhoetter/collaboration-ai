"""ASGI middleware that authenticates requests using a hof-os JWT.

When collaboration-ai runs as a sidecar inside hof-os, every browser
request is forwarded by ``packages/hof-components/starters/hofos/
domain/shared/subapp_proxy.py`` with an ``Authorization: Bearer
<jwt>`` header (and ``?token=<jwt>`` for WebSocket upgrades, which
disallow custom headers). The JWT is signed with the shared
``HOF_SUBAPP_JWT_SECRET`` and carries:

* ``sub`` — the hof-os user id (1:1 with collab-ai's ``users.user_id``)
* ``tid`` — the hof-os tenant id (used as the workspace)
* ``email``, ``displayName`` — surface fields for first-time upsert
* ``aud`` — must equal ``"collabai"``

This middleware:

1. Pulls the JWT out of either the header or the WS query param.
2. Verifies + parses claims via ``verify_hof_jwt``. On failure it
   passes the request through unchanged so the standalone
   ``demo:onboard`` flow keeps working in dev.
3. On success, idempotently upserts the user, the workspace, and a
   ``workspace_members`` row so the rest of the stack (event log,
   channel CRUD, presence) can rely on those rows existing.
4. Sets ``request.scope["state"]["actor_id"]`` and
   ``["workspace_id"]`` so handlers can read the caller's identity
   without re-parsing the token. ``demo:onboard`` and any function
   that explicitly takes ``actor_id`` / ``workspace_id`` in the body
   continue to win over these scope values — the middleware is
   strictly additive.

The upsert path is wrapped in a tiny in-process LRU so steady-state
traffic (one JWT per user/page-load, reused for every API call until
expiry) costs a single dict lookup per request.
"""

from __future__ import annotations

import logging
import time
from urllib.parse import parse_qs

from sqlalchemy import text
from starlette.types import ASGIApp, Receive, Scope, Send

from .hof_jwt import HofIdentity, extract_bearer, verify_hof_jwt
from .runtime import open_session

logger = logging.getLogger("collabai.jwt_middleware")


class HofSubappJwtMiddleware:
    """Honours hof-os JWTs on `/api/*` and `/ws/*`, falls through otherwise."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        audience: str = "collabai",
        upsert_cache_max: int = 1024,
    ) -> None:
        self.app = app
        self.audience = audience
        self._upsert_cache: dict[str, float] = {}
        self._upsert_cache_max = upsert_cache_max

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        token = self._extract_token(scope)
        if not token:
            await self.app(scope, receive, send)
            return

        try:
            identity = verify_hof_jwt(token, audience=self.audience)
        except ValueError as err:
            # Bad signature / expiry / audience mismatch. Don't 401 here:
            # the standalone web app sends no token at all and the
            # routes downstream still rely on demo:onboard. Logging at
            # debug level keeps prod logs quiet but lets `LOG_LEVEL=DEBUG`
            # surface tampered tokens.
            logger.debug("rejected hof JWT: %s", err)
            await self.app(scope, receive, send)
            return

        try:
            self._ensure_identity_persisted(identity)
        except Exception:  # noqa: BLE001 - observability over correctness
            logger.exception(
                "failed to upsert identity from JWT (user=%s tenant=%s); continuing anyway",
                identity.user_id,
                identity.tenant_id,
            )

        # Stash for downstream handlers. Starlette's Request object reads
        # `scope["state"]` lazily, so the assignments below show up as
        # `request.state.actor_id` etc. without any further wiring.
        state = scope.setdefault("state", {})
        state["actor_id"] = identity.user_id
        state["workspace_id"] = identity.tenant_id
        state["hof_identity"] = identity

        await self.app(scope, receive, send)

    @staticmethod
    def _extract_token(scope: Scope) -> str | None:
        # Authorization header — works for both http and websocket.
        for key, value in scope.get("headers", []):
            if key == b"authorization":
                token = extract_bearer(value.decode("latin-1", errors="ignore"))
                if token:
                    return token
        # WebSocket fallback: ?token=<jwt>. The browser cannot set
        # custom headers on `new WebSocket(...)`, so the upstream
        # client appends the JWT as a query param.
        if scope["type"] == "websocket":
            qs = scope.get("query_string", b"")
            if qs:
                params = parse_qs(qs.decode("latin-1", errors="ignore"))
                vals = params.get("token") or []
                if vals:
                    return vals[0] or None
        return None

    def _ensure_identity_persisted(self, identity: HofIdentity) -> None:
        """Idempotently persist the (user, workspace, membership) trio.

        Cached by ``user_id|tenant_id`` so repeat hits on the same
        identity within the JWT's lifetime are a single dict lookup.
        """
        cache_key = f"{identity.user_id}|{identity.tenant_id}"
        if cache_key in self._upsert_cache:
            return

        # Bound the cache so a long-lived sidecar with churn doesn't
        # leak memory. Eviction is intentionally crude (drop a third
        # of entries when full) — correctness doesn't depend on the
        # cache, just throughput.
        if len(self._upsert_cache) >= self._upsert_cache_max:
            for stale in list(self._upsert_cache.keys())[: self._upsert_cache_max // 3]:
                self._upsert_cache.pop(stale, None)

        with open_session() as session:
            display = identity.display_name or identity.user_id
            session.execute(
                text(
                    """
                    INSERT INTO users (id, user_id, display_name, is_anonymous)
                    VALUES (gen_random_uuid(), :uid, :name, FALSE)
                    ON CONFLICT (user_id) DO UPDATE
                      SET display_name = EXCLUDED.display_name,
                          is_anonymous = FALSE
                    """
                ),
                {"uid": identity.user_id, "name": display},
            )
            session.execute(
                text(
                    """
                    INSERT INTO workspaces (id, workspace_id, name, slug, created_at, created_by)
                    VALUES (gen_random_uuid(), :wid, :name, :slug, :ts, :created_by)
                    ON CONFLICT (workspace_id) DO NOTHING
                    """
                ),
                {
                    "wid": identity.tenant_id,
                    "name": identity.tenant_id,
                    "slug": identity.tenant_id.lower().replace(" ", "-"),
                    "ts": int(time.time() * 1000),
                    "created_by": identity.user_id,
                },
            )
            session.execute(
                text(
                    """
                    INSERT INTO workspace_members (id, workspace_id, user_id, role, joined_at)
                    VALUES (gen_random_uuid(), :wid, :uid, :role, :ts)
                    ON CONFLICT (workspace_id, user_id) DO NOTHING
                    """
                ),
                {
                    "wid": identity.tenant_id,
                    "uid": identity.user_id,
                    "role": "admin",
                    "ts": int(time.time() * 1000),
                },
            )
            # workspace_sequence row is required by the event log; the
            # sequence starts at 0 and is bumped by the dispatcher.
            session.execute(
                text(
                    """
                    INSERT INTO workspace_sequence (id, workspace_id, seq)
                    VALUES (gen_random_uuid(), :wid, 0)
                    ON CONFLICT (workspace_id) DO NOTHING
                    """
                ),
                {"wid": identity.tenant_id},
            )
            session.commit()

        self._upsert_cache[cache_key] = time.time()


__all__ = ["HofSubappJwtMiddleware"]
