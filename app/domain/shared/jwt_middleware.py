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
   without re-parsing the token, and normalises JSON function bodies to
   the verified JWT identity so a stale browser store cannot spoof or
   drift away from the session workspace.

The upsert path is wrapped in a tiny in-process LRU so steady-state
traffic (one JWT per user/page-load, reused for every API call until
expiry) costs a single dict lookup per request.
"""

from __future__ import annotations

import json
import logging
import os
import time
from http.cookies import SimpleCookie
from urllib import request as urllib_request
from urllib.parse import parse_qs, urlencode

from sqlalchemy import text
from starlette.types import ASGIApp, Receive, Scope, Send

from ..events.ids import make_event_id, now_ms
from ..events.model import Event, EventEnvelope
from ..events.projector import ProjectedState, project_event
from .hof_jwt import HofIdentity, extract_bearer, verify_hof_jwt
from .runtime import get_command_bus, open_session

logger = logging.getLogger("collabai.jwt_middleware")
HANDOFF_QUERY_PARAM = "__hof_jwt"
HANDOFF_CODE_QUERY_PARAM = "__hof_handoff"
SESSION_COOKIE = "hof_subapp_session"
SESSION_TTL_SECONDS = 8 * 60 * 60


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

        if scope["type"] == "http":
            handoff_code = self._extract_handoff_code(scope)
            if handoff_code:
                await self._handle_handoff_code(scope, send, handoff_code)
                return
            handoff_token = self._extract_handoff_token(scope)
            if handoff_token:
                await self._handle_handoff(scope, send, handoff_token)
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

        if scope["type"] == "http" and self._should_normalize_function_body(scope):
            receive = await self._normalize_function_body(scope, receive, identity)

        await self.app(scope, receive, send)

    def _extract_handoff_token(self, scope: Scope) -> str | None:
        qs = scope.get("query_string", b"")
        if not qs:
            return None
        params = parse_qs(qs.decode("latin-1", errors="ignore"))
        vals = params.get(HANDOFF_QUERY_PARAM) or []
        return vals[0] if vals else None

    def _extract_handoff_code(self, scope: Scope) -> str | None:
        qs = scope.get("query_string", b"")
        if not qs:
            return None
        params = parse_qs(qs.decode("latin-1", errors="ignore"))
        vals = params.get(HANDOFF_CODE_QUERY_PARAM) or []
        return vals[0] if vals else None

    async def _handle_handoff_code(self, scope: Scope, send: Send, code: str) -> None:
        try:
            token = self._exchange_handoff_code(code)
        except Exception as err:  # noqa: BLE001 - exact urllib errors vary
            logger.debug("rejected hof handoff code: %s", err)
            token = None
        await self._redirect_with_optional_session(scope, send, token)

    def _exchange_handoff_code(self, code: str) -> str:
        base_url = _data_app_base_url()
        payload = json.dumps({"audience": self.audience, "code": code}).encode("utf-8")
        req = urllib_request.Request(
            f"{base_url}/api/subapp-handoff/exchange",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib_request.urlopen(req, timeout=5) as res:
            body = json.loads(res.read().decode("utf-8"))
        if body.get("audience") != self.audience:
            raise ValueError("handoff audience mismatch")
        token = body.get("token")
        if not isinstance(token, str) or not token:
            raise ValueError("handoff response missing token")
        return token

    async def _handle_handoff(self, scope: Scope, send: Send, token: str) -> None:
        await self._redirect_with_optional_session(scope, send, token)

    async def _redirect_with_optional_session(
        self,
        scope: Scope,
        send: Send,
        token: str | None,
    ) -> None:
        cookie: str | None = None
        try:
            identity = verify_hof_jwt(token, audience=self.audience) if token else None
        except ValueError as err:
            logger.debug("rejected hof JWT handoff: %s", err)
        else:
            if identity and token:
                secure = "; Secure" if (os.environ.get("HOF_ENV") or "dev").lower() == "production" else ""
                max_age = _session_max_age(identity)
                cookie = (
                    f"{SESSION_COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/; "
                    f"Max-Age={max_age}{secure}"
                )

        headers: list[tuple[bytes, bytes]] = [(b"location", self._clean_handoff_path(scope).encode())]
        if cookie:
            headers.append((b"set-cookie", cookie.encode()))
        await send({"type": "http.response.start", "status": 302, "headers": headers})
        await send({"type": "http.response.body", "body": b""})

    @staticmethod
    def _clean_handoff_path(scope: Scope) -> str:
        raw_qs = scope.get("query_string", b"").decode("latin-1", errors="ignore")
        filtered = [
            (key, value)
            for key, values in parse_qs(raw_qs, keep_blank_values=True).items()
            if key not in {HANDOFF_QUERY_PARAM, HANDOFF_CODE_QUERY_PARAM}
            for value in values
        ]
        query = urlencode(filtered)
        path = scope.get("path") or "/"
        return f"{path}?{query}" if query else path

    @staticmethod
    def _extract_token(scope: Scope) -> str | None:
        # Authorization header — works for both http and websocket.
        for key, value in scope.get("headers", []):
            if key == b"authorization":
                token = extract_bearer(value.decode("latin-1", errors="ignore"))
                if token:
                    return token
        for key, value in scope.get("headers", []):
            if key == b"cookie":
                cookie = SimpleCookie()
                cookie.load(value.decode("latin-1", errors="ignore"))
                morsel = cookie.get(SESSION_COOKIE)
                if morsel and morsel.value:
                    return morsel.value
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

        # Bootstrap the event-sourced projection so this user can issue
        # commands. The SQL upsert above keeps any direct SQL readers
        # (e.g. ``users:list`` for the DM picker) consistent, but the
        # `CommandBus` authorises against `ProjectedState` which is
        # built **only** from the event log. Without these events the
        # very first `channel:create` from a freshly-JIT'd user fails
        # with "Actor is not a workspace member" even though the SQL
        # row exists. See ``handlers._require_workspace_membership``.
        if self._bootstrap_projection_events(identity):
            self._upsert_cache[cache_key] = time.time()

    @staticmethod
    def _should_normalize_function_body(scope: Scope) -> bool:
        path = str(scope.get("path") or "")
        if not path.startswith("/api/functions/"):
            return False
        for key, value in scope.get("headers", []):
            if key == b"content-type" and b"application/json" in value.lower():
                return True
        return False

    async def _normalize_function_body(
        self,
        scope: Scope,
        receive: Receive,
        identity: HofIdentity,
    ) -> Receive:
        body = b""
        more_body = True
        while more_body:
            message = await receive()
            if message["type"] != "http.request":
                return receive
            body += message.get("body", b"")
            more_body = bool(message.get("more_body"))

        try:
            payload = json.loads(body.decode("utf-8") or "{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            return _single_body_receive(body)

        if not isinstance(payload, dict):
            return _single_body_receive(body)

        payload["actor_id"] = identity.user_id
        payload["workspace_id"] = identity.tenant_id
        normalized = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        _replace_content_length(scope, len(normalized))
        return _single_body_receive(normalized)

    def _bootstrap_projection_events(self, identity: HofIdentity) -> bool:
        """Append `workspace.create` + `workspace.member.add` to the log.

        Idempotent in two layers:

        1. Cheap in-memory short-circuit when the projection already
           knows about this (workspace, user) pair — the common case
           for a long-lived sidecar.
        2. Deterministic ``idempotency_key`` per envelope so a parallel
           racer (or a missed cache hit) collapses to the existing row
           via ``PostgresCommitter`` 's unique index, instead of
           inserting a duplicate.

        Errors are swallowed (logged) — the JWT verify path must not
        fail because of bootstrap drift; downstream handlers will
        re-attempt to authorise on the next command and will fail with
        a useful "forbidden" if the events truly never landed.
        """
        try:
            bus = get_command_bus()
        except Exception:  # noqa: BLE001 — first-boot bus init can fail before tables exist
            logger.exception(
                "command bus unavailable during JIT bootstrap (user=%s tenant=%s)",
                identity.user_id,
                identity.tenant_id,
            )
            return False

        state = bus.projector_state
        if state is not None:
            members = state.workspace_members.get(identity.tenant_id, {})
            if identity.user_id in members:
                return True  # already in the event-projection — nothing to emit

        envelopes: list[EventEnvelope] = []
        workspace_known = state is not None and identity.tenant_id in state.workspaces
        if not workspace_known:
            envelopes.append(
                EventEnvelope(
                    event_id=make_event_id(),
                    type="workspace.create",
                    content={
                        "name": identity.tenant_id,
                        "slug": identity.tenant_id.lower().replace(" ", "-"),
                    },
                    workspace_id=identity.tenant_id,
                    room_id=identity.tenant_id,
                    sender_id=identity.user_id,
                    sender_type="system",
                    idempotency_key=f"bootstrap:workspace:{identity.tenant_id}",
                )
            )

        envelopes.append(
            EventEnvelope(
                event_id=make_event_id(),
                type="workspace.member.add",
                content={"user_id": identity.user_id, "role": "admin"},
                workspace_id=identity.tenant_id,
                room_id=identity.tenant_id,
                sender_id=identity.user_id,
                sender_type="system",
                idempotency_key=f"bootstrap:member:{identity.tenant_id}:{identity.user_id}",
            )
        )

        try:
            if bus.committer is not None:
                committed = bus.committer.commit(envelopes)
            elif state is not None:
                # Test / standalone mode without a real Postgres log:
                # fabricate sequences off the in-memory state so the
                # projector can still apply them. Mirrors
                # ``CommandBus._local_commit`` (kept inline to avoid
                # importing a private helper from the bus module).
                committed = _fabricate_local_events(envelopes, state)
            else:
                return False
        except Exception:  # noqa: BLE001 — observability over correctness
            logger.exception(
                "bootstrap projection events failed (user=%s tenant=%s)",
                identity.user_id,
                identity.tenant_id,
            )
            return False

        # Project synchronously so subsequent commands in this very
        # request (e.g. the channel:create that triggered the JWT
        # verify) see the actor as a workspace member without waiting
        # for the Celery projector to catch up.
        if state is not None:
            for evt in committed:
                project_event(state, evt)
            members = state.workspace_members.get(identity.tenant_id, {})
            return identity.user_id in members
        return True


def _data_app_base_url() -> str:
    return (
        os.environ.get("HOF_DATA_APP_INTERNAL_URL")
        or os.environ.get("HOF_DATA_APP_PUBLIC_URL")
        or os.environ.get("HOF_OS_PUBLIC_URL")
        or "http://localhost:3000"
    ).rstrip("/")


def _session_max_age(identity: HofIdentity | None) -> int:
    if identity and identity.exp:
        return max(1, min(SESSION_TTL_SECONDS, identity.exp - int(time.time())))
    return SESSION_TTL_SECONDS


def _fabricate_local_events(
    envelopes: list[EventEnvelope], state: ProjectedState
) -> list[Event]:
    """Mint workspace-monotonic sequences off ``state.last_sequence``.

    Used when no real ``Committer`` is bound (unit tests / standalone
    dev). The bus' built-in ``_local_commit`` does the same; we
    duplicate the few lines instead of importing a private helper to
    keep the middleware decoupled from the bus internals.
    """
    ts = now_ms()
    out: list[Event] = []
    for env in envelopes:
        last = state.last_sequence.get(env.workspace_id, 0)
        seq = last + 1
        state.last_sequence[env.workspace_id] = seq
        out.append(
            Event(
                event_id=env.event_id,
                type=env.type,
                content=env.content,
                workspace_id=env.workspace_id,
                room_id=env.room_id,
                sender_id=env.sender_id,
                sender_type=env.sender_type,
                origin_ts=ts,
                sequence=seq,
                agent_id=env.agent_id,
                relates_to=env.relates_to,
                idempotency_key=env.idempotency_key,
                origin=env.origin,
            )
        )
    return out


def _single_body_receive(body: bytes) -> Receive:
    sent = False

    async def receive() -> dict:
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    return receive


def _replace_content_length(scope: Scope, size: int) -> None:
    headers = [
        (key, value)
        for key, value in scope.get("headers", [])
        if key.lower() != b"content-length"
    ]
    headers.append((b"content-length", str(size).encode("ascii")))
    scope["headers"] = headers


__all__ = ["HofSubappJwtMiddleware"]
