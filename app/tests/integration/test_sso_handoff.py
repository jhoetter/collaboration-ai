from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

import pytest
from starlette.testclient import TestClient
from starlette.types import Receive, Scope, Send

from domain.shared.jwt_middleware import HofSubappJwtMiddleware


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _mint(secret: str, **claims: Any) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "aud": "collabai",
        "sub": "user-1",
        "tid": "tenant-1",
        "exp": int(time.time()) + 120,
        **claims,
    }
    h = _b64url(json.dumps(header, separators=(",", ":")).encode())
    p = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(secret.encode(), f"{h}.{p}".encode("ascii"), hashlib.sha256).digest()
    return f"{h}.{p}.{_b64url(sig)}"


async def _identity_app(scope: Scope, receive: Receive, send: Send) -> None:
    state = scope.get("state", {})
    identity = state.get("hof_identity")
    body = json.dumps(
        {
            "actor_id": state.get("actor_id"),
            "workspace_id": state.get("workspace_id"),
            "identity_user": getattr(identity, "user_id", None),
        }
    ).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"content-type", b"application/json")],
        }
    )
    await send({"type": "http.response.body", "body": body})


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOF_ENV", "dev")
    monkeypatch.setenv("HOF_SUBAPP_JWT_SECRET", "current-secret")
    monkeypatch.delenv("HOF_SUBAPP_JWT_SECRET_PREVIOUS", raising=False)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(
        HofSubappJwtMiddleware,
        "_ensure_identity_persisted",
        lambda self, identity: None,
    )
    return TestClient(HofSubappJwtMiddleware(_identity_app, audience="collabai"))


def test_handoff_sets_session_cookie_and_strips_query(client: TestClient) -> None:
    token = _mint("current-secret")

    response = client.get(f"/?__hof_jwt={token}&next=chat", follow_redirects=False)

    assert response.status_code == 302
    assert response.headers["location"] == "/?next=chat"
    assert "hof_subapp_session=" in response.headers["set-cookie"]
    assert "Max-Age=" in response.headers["set-cookie"]
    assert "__hof_jwt" not in response.headers["location"]


def test_handoff_code_exchanges_token_sets_session_and_strips_query(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token = _mint("current-secret")
    exchanged: list[str] = []

    def fake_exchange(self: HofSubappJwtMiddleware, code: str) -> str:
        exchanged.append(f"{self.audience}:{code}")
        return token

    monkeypatch.setattr(HofSubappJwtMiddleware, "_exchange_handoff_code", fake_exchange)

    response = client.get("/?__hof_handoff=opaque-code&next=chat", follow_redirects=False)

    assert response.status_code == 302
    assert response.headers["location"] == "/?next=chat"
    assert "hof_subapp_session=" in response.headers["set-cookie"]
    assert "__hof_handoff" not in response.headers["location"]
    assert exchanged == ["collabai:opaque-code"]


def test_invalid_handoff_code_redirects_without_session(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_exchange(self: HofSubappJwtMiddleware, code: str) -> str:
        raise RuntimeError("nope")

    monkeypatch.setattr(HofSubappJwtMiddleware, "_exchange_handoff_code", fail_exchange)

    response = client.get("/?__hof_handoff=bad-code&next=chat", follow_redirects=False)

    assert response.status_code == 302
    assert response.headers["location"] == "/?next=chat"
    assert "set-cookie" not in response.headers
    assert "__hof_handoff" not in response.headers["location"]


def test_session_cookie_authenticates_follow_up_request(client: TestClient) -> None:
    token = _mint("current-secret")

    response = client.get("/whoami", headers={"cookie": f"hof_subapp_session={token}"})

    assert response.status_code == 200
    assert response.json() == {
        "actor_id": "user-1",
        "workspace_id": "tenant-1",
        "identity_user": "user-1",
    }


def test_wrong_audience_handoff_is_rejected(client: TestClient) -> None:
    token = _mint("current-secret", aud="mailai")

    response = client.get(f"/?__hof_jwt={token}", follow_redirects=False)

    assert response.status_code == 302
    assert "set-cookie" not in response.headers


def test_tampered_handoff_is_rejected(client: TestClient) -> None:
    token = _mint("current-secret")[:-1] + "x"

    response = client.get(f"/?__hof_jwt={token}", follow_redirects=False)

    assert response.status_code == 302
    assert "set-cookie" not in response.headers


def test_expired_handoff_is_rejected(client: TestClient) -> None:
    token = _mint("current-secret", exp=int(time.time()) - 1)

    response = client.get(f"/?__hof_jwt={token}", follow_redirects=False)

    assert response.status_code == 302
    assert "set-cookie" not in response.headers


def test_previous_secret_is_accepted_during_rotation(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOF_SUBAPP_JWT_SECRET", "new-secret")
    monkeypatch.setenv("HOF_SUBAPP_JWT_SECRET_PREVIOUS", "old-secret")
    token = _mint("old-secret")

    response = client.get(f"/?__hof_jwt={token}", follow_redirects=False)

    assert response.status_code == 302
    assert "hof_subapp_session=" in response.headers["set-cookie"]
