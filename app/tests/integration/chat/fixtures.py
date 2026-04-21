"""Realistic chat corpus used across the Phase 3 acceptance tests."""

from __future__ import annotations

from dataclasses import dataclass

from domain.events.projector import ProjectedState
from domain.shared.command_bus import Command, CommandBus, CommandResult
from domain.shared.handlers import register_default_handlers


@dataclass
class Bootstrap:
    bus: CommandBus
    state: ProjectedState
    workspace_id: str
    users: list[str]
    channels: list[str]


def bootstrap(workspace_id: str = "ws_demo", *, n_users: int = 5) -> Bootstrap:
    state = ProjectedState()
    bus = register_default_handlers(CommandBus(projector_state=state))

    owner = "usr_owner"
    bus.dispatch(
        Command(
            type="workspace:create",
            payload={"name": "Demo"},
            source="human",
            actor_id=owner,
            workspace_id=workspace_id,
        )
    )

    users = [owner] + [f"usr_{i}" for i in range(n_users)]
    for uid in users[1:]:
        bus.dispatch(
            Command(
                type="workspace:invite",
                payload={"user_id": uid, "role": "member"},
                source="human",
                actor_id=owner,
                workspace_id=workspace_id,
            )
        )

    channels = ["ch_general", "ch_random", "ch_dev"]
    for ch in channels:
        bus.dispatch(
            Command(
                type="channel:create",
                payload={"name": ch, "member_ids": users},
                source="human",
                actor_id=owner,
                workspace_id=workspace_id,
                room_id=ch,
            )
        )

    return Bootstrap(bus=bus, state=state, workspace_id=workspace_id, users=users, channels=channels)


def send(bs: Bootstrap, sender: str, channel: str, content: str, **payload_extra) -> CommandResult:
    return bs.bus.dispatch(
        Command(
            type="chat:send-message",
            payload={"content": content, **payload_extra},
            source="human",
            actor_id=sender,
            workspace_id=bs.workspace_id,
            room_id=channel,
        )
    )
