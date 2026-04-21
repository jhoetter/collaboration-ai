"""Idempotent demo seed.

Run after ``make db-up`` (and once before ``make dev``) to drop a usable
workspace, three channels, a planner agent and a couple of pending
agent proposals into Postgres so two browser windows can chat over a
fresh clone with no extra setup.

Mirrors the ``hof-os`` starter pattern: bootstrap hof-engine, then walk
through the desired state. Every step is a "if it's already there,
skip" check, so re-running the script is safe.
"""

from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import text

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from hof.cli.commands import bootstrap as hof_bootstrap  # noqa: E402

DEMO_WORKSPACE_ID = "w_demo"
DEMO_WORKSPACE_NAME = "Demo"
DEMO_WORKSPACE_SLUG = "demo"

SYSTEM_USER_ID = "u_system"
SYSTEM_DISPLAY_NAME = "System"

DEFAULT_CHANNELS = [
    ("c_general", "general", "Welcome — this is where the team hangs out."),
    ("c_random", "random", "Off-topic chatter, gifs, etc."),
    ("c_engineering", "engineering", "Engineering discussion + planner agent."),
]

PLANNER_AGENT_ID = "agent_planner"
PLANNER_DISPLAY_NAME = "Planner Agent"
PLANNER_SCOPES = ["chat:propose-message"]

DEMO_PROPOSALS = [
    {
        "channel_id": "c_engineering",
        "content": "Heads up: I drafted a status update — review and approve to post.",
        "rationale": "Weekly status digest from the planner agent.",
    },
    {
        "channel_id": "c_general",
        "content": "Welcome to the demo workspace! Open another browser to see live sync in action.",
        "rationale": "Onboarding hint surfaced as a proposal so the inbox shows something useful.",
    },
]


def main() -> None:
    hof_bootstrap(PROJECT_ROOT)

    from domain.events.ids import now_ms  # noqa: WPS433
    from domain.shared.command_bus import Command  # noqa: WPS433
    from domain.shared.runtime import get_command_bus, get_session_factory  # noqa: WPS433

    session_factory = get_session_factory()

    # ------------------------------------------------------------------
    # Direct projection inserts for things the bus can't synthesise on
    # its own (the system user identity row + the planner agent — neither
    # has a corresponding command handler today).
    # ------------------------------------------------------------------
    with session_factory() as session:
        _upsert_system_user(session)
        session.commit()

    bus = get_command_bus()

    # ------------------------------------------------------------------
    # Workspace + channels via the command bus so events land in the log
    # (and so the in-memory authorisation state stays consistent with
    # what the running web server sees).
    # ------------------------------------------------------------------
    with session_factory() as session:
        if not _workspace_exists(session, DEMO_WORKSPACE_ID):
            res = bus.dispatch(
                Command(
                    type="workspace:create",
                    payload={"name": DEMO_WORKSPACE_NAME, "slug": DEMO_WORKSPACE_SLUG},
                    source="human",
                    actor_id=SYSTEM_USER_ID,
                    workspace_id=DEMO_WORKSPACE_ID,
                )
            )
            _assert_applied(res, "workspace:create")

        existing_channels = _existing_channel_ids(session, DEMO_WORKSPACE_ID)

    for channel_id, name, topic in DEFAULT_CHANNELS:
        if channel_id in existing_channels:
            continue
        res = bus.dispatch(
            Command(
                type="channel:create",
                payload={
                    "name": name,
                    "type": "public",
                    "private": False,
                    "topic": topic,
                    "staging_policy": "agent-messages-require-approval",
                    "slow_mode_seconds": 0,
                    "member_ids": [SYSTEM_USER_ID],
                },
                source="human",
                actor_id=SYSTEM_USER_ID,
                workspace_id=DEMO_WORKSPACE_ID,
                room_id=channel_id,
            )
        )
        _assert_applied(res, f"channel:create {channel_id}")

    # ------------------------------------------------------------------
    # Planner agent + a couple of pending proposals so the agent inbox
    # has visible items on first load.
    # ------------------------------------------------------------------
    with session_factory() as session:
        _upsert_agent(
            session,
            agent_id=PLANNER_AGENT_ID,
            workspace_id=DEMO_WORKSPACE_ID,
            display_name=PLANNER_DISPLAY_NAME,
            scopes=PLANNER_SCOPES,
            registered_by=SYSTEM_USER_ID,
        )
        session.commit()

        existing_command_payload_keys = _existing_proposal_keys(session, DEMO_WORKSPACE_ID)

    for spec in DEMO_PROPOSALS:
        signature = (spec["channel_id"], spec["content"])
        if signature in existing_command_payload_keys:
            continue
        res = bus.dispatch(
            Command(
                type="agent:propose-message",
                payload={
                    "content": spec["content"],
                    "channel_id": spec["channel_id"],
                    "rationale": spec["rationale"],
                },
                source="agent",
                actor_id=PLANNER_AGENT_ID,
                workspace_id=DEMO_WORKSPACE_ID,
                room_id=spec["channel_id"],
                agent_id=PLANNER_AGENT_ID,
            )
        )
        _assert_applied(res, f"agent:propose-message {spec['channel_id']}", expected_status="staged")

    print(
        f"Seed OK — workspace={DEMO_WORKSPACE_ID}, "
        f"channels={[c[0] for c in DEFAULT_CHANNELS]}, "
        f"agent={PLANNER_AGENT_ID}, "
        f"open http://localhost:3300 to start chatting."
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _upsert_system_user(session) -> None:  # type: ignore[no-untyped-def]
    session.execute(
        text(
            """
            INSERT INTO users (user_id, display_name, is_anonymous)
            VALUES (:uid, :name, FALSE)
            ON CONFLICT (user_id) DO UPDATE
              SET display_name = EXCLUDED.display_name,
                  is_anonymous = FALSE
            """
        ),
        {"uid": SYSTEM_USER_ID, "name": SYSTEM_DISPLAY_NAME},
    )


def _workspace_exists(session, workspace_id: str) -> bool:  # type: ignore[no-untyped-def]
    row = session.execute(
        text("SELECT 1 FROM workspaces WHERE workspace_id = :w LIMIT 1"),
        {"w": workspace_id},
    ).first()
    return row is not None


def _existing_channel_ids(session, workspace_id: str) -> set[str]:  # type: ignore[no-untyped-def]
    rows = session.execute(
        text("SELECT channel_id FROM channels WHERE workspace_id = :w"),
        {"w": workspace_id},
    ).fetchall()
    return {row[0] for row in rows}


def _upsert_agent(  # type: ignore[no-untyped-def]
    session,
    *,
    agent_id: str,
    workspace_id: str,
    display_name: str,
    scopes: list[str],
    registered_by: str,
) -> None:
    from domain.events.ids import now_ms  # noqa: WPS433

    session.execute(
        text(
            """
            INSERT INTO agents (agent_id, workspace_id, display_name, scopes,
                                registered_at, registered_by)
            VALUES (:aid, :wid, :name, :scopes, :ts, :sender)
            ON CONFLICT (agent_id) DO UPDATE
              SET display_name = EXCLUDED.display_name,
                  scopes = EXCLUDED.scopes
            """
        ),
        {
            "aid": agent_id,
            "wid": workspace_id,
            "name": display_name,
            "scopes": scopes,
            "ts": now_ms(),
            "sender": registered_by,
        },
    )


def _existing_proposal_keys(session, workspace_id: str) -> set[tuple[str, str]]:  # type: ignore[no-untyped-def]
    rows = session.execute(
        text(
            """
            SELECT channel_id, payload
            FROM proposals
            WHERE workspace_id = :w
            """
        ),
        {"w": workspace_id},
    ).mappings()
    out: set[tuple[str, str]] = set()
    for row in rows:
        payload = row["payload"] or {}
        content = payload.get("content") if isinstance(payload, dict) else None
        if content:
            out.add((row["channel_id"], content))
    return out


def _assert_applied(result, label: str, *, expected_status: str = "applied") -> None:  # type: ignore[no-untyped-def]
    if result.status != expected_status:
        err = result.error.message if result.error else "(no error message)"
        raise RuntimeError(f"seed step {label!r} failed with status={result.status!r}: {err}")


if __name__ == "__main__":
    main()
