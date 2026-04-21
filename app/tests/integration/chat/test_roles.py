"""Role-based authorization for workspace mutations."""

from __future__ import annotations

from domain.shared.command_bus import Command

from .fixtures import bootstrap


def _set_role(bs, actor: str, target: str, role: str):
    return bs.bus.dispatch(
        Command(
            type="workspace:set-role",
            payload={"user_id": target, "role": role},
            source="human",
            actor_id=actor,
            workspace_id=bs.workspace_id,
        )
    )


def _invite(bs, actor: str, new_user: str):
    return bs.bus.dispatch(
        Command(
            type="workspace:invite",
            payload={"user_id": new_user, "role": "member"},
            source="human",
            actor_id=actor,
            workspace_id=bs.workspace_id,
        )
    )


def test_member_cannot_invite() -> None:
    bs = bootstrap()
    member = bs.users[1]
    res = _invite(bs, member, "usr_new")
    assert res.status == "rejected"
    assert res.error and res.error.code == "forbidden"


def test_owner_can_invite_and_can_set_role() -> None:
    bs = bootstrap()
    owner = bs.users[0]
    assert _invite(bs, owner, "usr_new").status == "applied"
    assert _set_role(bs, owner, bs.users[1], "admin").status == "applied"


def test_admin_can_invite_but_cannot_set_role() -> None:
    bs = bootstrap()
    owner = bs.users[0]
    admin = bs.users[1]
    _set_role(bs, owner, admin, "admin")
    assert _invite(bs, admin, "usr_new").status == "applied"
    res = _set_role(bs, admin, bs.users[2], "admin")
    assert res.status == "rejected"
    assert res.error and res.error.code == "forbidden"
