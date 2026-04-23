"""HS256 JWT verifier matching hof-os' ``domain.shared.subapp_proxy``.

When collaboration-ai runs as a sidecar in a hof-os Compose stack, the
data-app forwards browser requests with a Bearer JWT minted by
``issue_subapp_token`` (audience: ``"collabai"``). This module gives
the rest of collaboration-ai a single helper to verify that token and
extract the caller's identity.

Crypto is hand-rolled (stdlib ``hmac``/``hashlib``) instead of pulling
in pyjwt because the contract is symmetric with hof-os, which also
hand-rolls JWT for the same dep-light reason. The wire format is
standard HS256 JWT so any off-the-shelf verifier works too.

Wiring this into the actual hof-engine request chain (FastAPI
dependency / middleware) lives outside this file — it depends on
hof-engine exposing a plug-in dependency contract, tracked separately.
This module is the cryptographic primitive both that wiring and any
future Traefik forward-auth bridge will consume.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from base64 import urlsafe_b64decode
from dataclasses import dataclass


_DEV_FALLBACK_SECRET = "dev-only-not-for-prod-9c2f"
DEFAULT_AUDIENCE = "collabai"


@dataclass(frozen=True)
class HofIdentity:
    user_id: str
    tenant_id: str
    email: str | None = None
    display_name: str | None = None


def _secret() -> bytes:
    raw = (os.environ.get("HOF_SUBAPP_JWT_SECRET") or "").strip()
    if not raw:
        if (os.environ.get("HOF_ENV") or "dev").lower() == "production":
            raise RuntimeError(
                "HOF_SUBAPP_JWT_SECRET must be set in production",
            )
        raw = _DEV_FALLBACK_SECRET
    return raw.encode("utf-8")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return urlsafe_b64decode(data + pad)


def verify_hof_jwt(token: str, *, audience: str = DEFAULT_AUDIENCE) -> HofIdentity:
    """Verify a hof-os–issued JWT, returning the caller's identity.

    Raises :class:`ValueError` on tamper, expiry, or audience mismatch.
    """
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("malformed JWT")
    h, p, s = parts
    signing_input = f"{h}.{p}".encode("ascii")
    expected = hmac.new(_secret(), signing_input, hashlib.sha256).digest()
    actual = _b64url_decode(s)
    if not hmac.compare_digest(expected, actual):
        raise ValueError("bad signature")
    claims_raw = json.loads(_b64url_decode(p))
    if not isinstance(claims_raw, dict):
        raise ValueError("claims must be a JSON object")
    exp = claims_raw.get("exp")
    if isinstance(exp, (int, float)) and exp < time.time():
        raise ValueError("token expired")
    if claims_raw.get("aud") != audience:
        raise ValueError(f"audience {claims_raw.get('aud')!r} != {audience!r}")
    sub = claims_raw.get("sub")
    tid = claims_raw.get("tid")
    if not isinstance(sub, str) or not isinstance(tid, str):
        raise ValueError("missing sub/tid claims")
    email = claims_raw.get("email")
    display_name = claims_raw.get("displayName")
    return HofIdentity(
        user_id=sub,
        tenant_id=tid,
        email=email if isinstance(email, str) else None,
        display_name=display_name if isinstance(display_name, str) else None,
    )


def extract_bearer(authorization_header: str | None) -> str | None:
    """Pull the token out of a standard ``Authorization: Bearer …`` header."""
    if not authorization_header:
        return None
    parts = authorization_header.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


__all__ = [
    "DEFAULT_AUDIENCE",
    "HofIdentity",
    "extract_bearer",
    "verify_hof_jwt",
]
