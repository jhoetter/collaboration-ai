"""Built-in command handlers.

Each handler is a pure function ``(Command, ProjectedState) ->
list[EventEnvelope]``. They are registered onto the bus via
``register_default_handlers``. The hof-engine `@function` endpoints in
``app/domain/<entity>/functions.py`` build a ``Command`` and call
``CommandBus.dispatch`` — they don't replicate any of this logic.

These handlers are intentionally side-effect free: no DB access, no
network. The bus' ``Committer`` is the only side effect, and it is
swapped out under test for an in-memory list.
"""

from __future__ import annotations

from typing import Any

from ..events.ids import (
    make_dm_channel_id,
    make_event_id,
    make_notification_id,
    make_proposal_id,
    make_reminder_id,
    make_scheduled_id,
)
from ..events.model import EventEnvelope, RelatesTo
from ..events.projector import ProjectedState
from .command_bus import Command, CommandBus, CommandRejected


# ---------------------------------------------------------------------------
# Authorisation helpers
# ---------------------------------------------------------------------------


def _require_workspace_membership(cmd: Command, state: ProjectedState) -> None:
    members = state.workspace_members.get(cmd.workspace_id, {})
    if cmd.actor_id not in members:
        raise CommandRejected("forbidden", "Actor is not a workspace member")


def _require_channel_membership(cmd: Command, state: ProjectedState, channel_id: str) -> None:
    ch = state.channels.get(channel_id)
    if ch is None:
        raise CommandRejected("not_found", f"Unknown channel {channel_id}")
    # Workspace membership is a hard prerequisite for any channel access.
    workspace_members = state.workspace_members.get(cmd.workspace_id, {})
    if cmd.actor_id not in workspace_members and cmd.source != "system":
        raise CommandRejected("forbidden", "Actor is not a workspace member")
    members = state.channel_members.get(channel_id, {})
    if cmd.actor_id not in members and ch.get("private", False):
        raise CommandRejected("forbidden", "Actor is not a member of this private channel")


def _require_role(cmd: Command, state: ProjectedState, *, allowed: set[str]) -> None:
    members = state.workspace_members.get(cmd.workspace_id, {})
    member = members.get(cmd.actor_id)
    if member is None or member.get("role") not in allowed:
        raise CommandRejected("forbidden", f"Requires role in {sorted(allowed)}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _envelope(
    cmd: Command,
    *,
    type: str,
    content: dict[str, Any],
    room_id: str | None = None,
    relates_to: RelatesTo | None = None,
) -> EventEnvelope:
    return EventEnvelope(
        event_id=make_event_id(),
        type=type,  # type: ignore[arg-type]
        content=content,
        workspace_id=cmd.workspace_id,
        room_id=room_id or cmd.room_id or "",
        sender_id=cmd.actor_id,
        sender_type=cmd.source,
        agent_id=cmd.agent_id,
        relates_to=relates_to,
        idempotency_key=cmd.idempotency_key,
    )


# ---------------------------------------------------------------------------
# Workspace
# ---------------------------------------------------------------------------


def handle_workspace_create(cmd: Command, _state: ProjectedState) -> list[EventEnvelope]:
    return [
        _envelope(
            cmd,
            type="workspace.create",
            content=cmd.payload,
            room_id=cmd.workspace_id,
        ),
        EventEnvelope(
            event_id=make_event_id(),
            type="workspace.member.add",
            content={"user_id": cmd.actor_id, "role": "owner"},
            workspace_id=cmd.workspace_id,
            room_id=cmd.workspace_id,
            sender_id=cmd.actor_id,
            sender_type=cmd.source,
            idempotency_key=cmd.idempotency_key,
        ),
    ]


def handle_workspace_invite(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    _require_role(cmd, state, allowed={"owner", "admin"})
    return [_envelope(cmd, type="workspace.member.add", content=cmd.payload, room_id=cmd.workspace_id)]


def handle_workspace_set_role(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    _require_role(cmd, state, allowed={"owner"})
    return [_envelope(cmd, type="workspace.member.role-set", content=cmd.payload, room_id=cmd.workspace_id)]


# ---------------------------------------------------------------------------
# Channels
# ---------------------------------------------------------------------------


def handle_channel_create(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    _require_workspace_membership(cmd, state)
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "channel:create requires a room_id")
    payload = dict(cmd.payload)
    member_ids = list(payload.pop("member_ids", []))
    if cmd.actor_id not in member_ids:
        member_ids.append(cmd.actor_id)
    out: list[EventEnvelope] = [_envelope(cmd, type="channel.create", content=payload, room_id=cmd.room_id)]
    for uid in member_ids:
        out.append(
            EventEnvelope(
                event_id=make_event_id(),
                type="channel.member.join",
                content={"user_id": uid},
                workspace_id=cmd.workspace_id,
                room_id=cmd.room_id,
                sender_id=cmd.actor_id,
                sender_type=cmd.source,
                idempotency_key=cmd.idempotency_key,
            )
        )
    return out


def handle_channel_invite(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "channel:invite requires a room_id")
    _require_channel_membership(cmd, state, cmd.room_id)
    return [_envelope(cmd, type="channel.member.invite", content=cmd.payload, room_id=cmd.room_id)]


def handle_channel_set_topic(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "channel:set-topic requires a room_id")
    _require_channel_membership(cmd, state, cmd.room_id)
    return [_envelope(cmd, type="channel.topic.set", content=cmd.payload, room_id=cmd.room_id)]


def handle_channel_update(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "channel:update requires a room_id")
    _require_channel_membership(cmd, state, cmd.room_id)
    return [_envelope(cmd, type="channel.update", content=cmd.payload, room_id=cmd.room_id)]


def handle_channel_archive(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "channel:archive requires a room_id")
    ch = state.channels.get(cmd.room_id)
    if ch is None:
        raise CommandRejected("not_found", f"Unknown channel {cmd.room_id}")
    # Sender must be a workspace admin/owner OR the channel creator. DMs
    # cannot be archived (use leave instead).
    if ch.get("type") in {"dm", "group_dm"}:
        raise CommandRejected("invalid_command", "DMs cannot be archived")
    members = state.workspace_members.get(cmd.workspace_id, {})
    member = members.get(cmd.actor_id)
    is_admin = member is not None and member.get("role") in {"owner", "admin"}
    is_creator = ch.get("created_by") == cmd.actor_id
    if not (is_admin or is_creator):
        raise CommandRejected("forbidden", "Only admin or channel creator can archive")
    return [_envelope(cmd, type="channel.archive", content={}, room_id=cmd.room_id)]


def handle_channel_unarchive(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "channel:unarchive requires a room_id")
    ch = state.channels.get(cmd.room_id)
    if ch is None:
        raise CommandRejected("not_found", f"Unknown channel {cmd.room_id}")
    members = state.workspace_members.get(cmd.workspace_id, {})
    member = members.get(cmd.actor_id)
    is_admin = member is not None and member.get("role") in {"owner", "admin"}
    is_creator = ch.get("created_by") == cmd.actor_id
    if not (is_admin or is_creator):
        raise CommandRejected("forbidden", "Only admin or channel creator can unarchive")
    return [_envelope(cmd, type="channel.unarchive", content={}, room_id=cmd.room_id)]


def handle_channel_leave(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "channel:leave requires a room_id")
    target_user = cmd.payload.get("user_id") or cmd.actor_id
    members = state.channel_members.get(cmd.room_id, {})
    if target_user not in members:
        raise CommandRejected("not_found", "User is not a member of this channel")
    if target_user != cmd.actor_id:
        ws_members = state.workspace_members.get(cmd.workspace_id, {})
        member = ws_members.get(cmd.actor_id)
        if member is None or member.get("role") not in {"owner", "admin"}:
            raise CommandRejected("forbidden", "Only admin can remove other members")
    return [
        _envelope(
            cmd,
            type="channel.member.leave",
            content={"user_id": target_user},
            room_id=cmd.room_id,
        )
    ]


def handle_channel_kick(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "channel:kick requires a room_id")
    members = state.workspace_members.get(cmd.workspace_id, {})
    member = members.get(cmd.actor_id)
    if member is None or member.get("role") not in {"owner", "admin"}:
        raise CommandRejected("forbidden", "Only admin can kick from a channel")
    channel_members = state.channel_members.get(cmd.room_id, {})
    target = cmd.payload.get("user_id")
    if not target or target not in channel_members:
        raise CommandRejected("not_found", "User is not a member of this channel")
    return [_envelope(cmd, type="channel.member.kick", content=cmd.payload, room_id=cmd.room_id)]


def handle_chat_pin_message(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    target_id = cmd.payload.get("message_id")
    if not target_id:
        raise CommandRejected("invalid_payload", "message_id required")
    msg = state.messages.get(target_id)
    if msg is None or msg.get("redacted"):
        raise CommandRejected("not_found", f"Unknown message {target_id}")
    _require_channel_membership(cmd, state, msg["channel_id"])
    return [
        _envelope(
            cmd,
            type="channel.pin.add",
            content={"message_id": target_id},
            room_id=msg["channel_id"],
        )
    ]


def handle_chat_unpin_message(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    target_id = cmd.payload.get("message_id")
    if not target_id:
        raise CommandRejected("invalid_payload", "message_id required")
    msg = state.messages.get(target_id)
    if msg is None:
        raise CommandRejected("not_found", f"Unknown message {target_id}")
    _require_channel_membership(cmd, state, msg["channel_id"])
    return [
        _envelope(
            cmd,
            type="channel.pin.remove",
            content={"message_id": target_id},
            room_id=msg["channel_id"],
        )
    ]


def handle_chat_set_draft(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "chat:set-draft requires a room_id")
    return [_envelope(cmd, type="draft.set", content=cmd.payload, room_id=cmd.room_id)]


def handle_chat_clear_draft(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "chat:clear-draft requires a room_id")
    return [_envelope(cmd, type="draft.clear", content={}, room_id=cmd.room_id)]


def handle_user_set_status(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    _require_workspace_membership(cmd, state)
    return [
        _envelope(
            cmd,
            type="user.status.set",
            content=cmd.payload,
            room_id=cmd.workspace_id,
        )
    ]


def handle_user_set_presence(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    _require_workspace_membership(cmd, state)
    return [
        _envelope(
            cmd,
            type="user.presence.set",
            content=cmd.payload,
            room_id=cmd.workspace_id,
        )
    ]


def handle_user_snooze(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    _require_workspace_membership(cmd, state)
    return [
        _envelope(
            cmd,
            type="user.snooze.set",
            content=cmd.payload,
            room_id=cmd.workspace_id,
        )
    ]


def handle_user_set_display_name(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    _require_workspace_membership(cmd, state)
    return [
        _envelope(
            cmd,
            type="user.display-name.set",
            content=cmd.payload,
            room_id=cmd.workspace_id,
        )
    ]


# ---------------------------------------------------------------------------
# Huddles
# ---------------------------------------------------------------------------


def handle_huddle_start(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "huddle:start requires a room_id (channel)")
    _require_channel_membership(cmd, state, cmd.room_id)
    # If a huddle is already running we no-op (idempotent open). The
    # caller (frontend) will just connect to the existing room.
    existing = state.huddles.get(cmd.room_id) if hasattr(state, "huddles") else None
    if existing and not existing.get("ended_at"):
        return [
            _envelope(
                cmd,
                type="huddle.join",
                content={"huddle_id": existing["huddle_id"]},
                room_id=cmd.room_id,
            )
        ]
    huddle_id = cmd.payload.get("huddle_id") or make_event_id()
    livekit_room = cmd.payload.get("livekit_room") or huddle_id
    return [
        _envelope(
            cmd,
            type="huddle.start",
            content={
                "huddle_id": huddle_id,
                "livekit_room": livekit_room,
                **({"title": cmd.payload["title"]} if cmd.payload.get("title") else {}),
            },
            room_id=cmd.room_id,
        )
    ]


def handle_huddle_join(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "huddle:join requires a room_id")
    _require_channel_membership(cmd, state, cmd.room_id)
    huddle = (
        state.huddles.get(cmd.room_id) if hasattr(state, "huddles") else None
    )
    if huddle is None or huddle.get("ended_at"):
        raise CommandRejected("not_found", "No active huddle in this channel")
    return [
        _envelope(
            cmd,
            type="huddle.join",
            content={"huddle_id": huddle["huddle_id"]},
            room_id=cmd.room_id,
        )
    ]


def handle_huddle_leave(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "huddle:leave requires a room_id")
    huddle = (
        state.huddles.get(cmd.room_id) if hasattr(state, "huddles") else None
    )
    if huddle is None:
        # Best-effort idempotent leave — silently no-op.
        return []
    return [
        _envelope(
            cmd,
            type="huddle.leave",
            content={"huddle_id": huddle["huddle_id"]},
            room_id=cmd.room_id,
        )
    ]


def handle_huddle_end(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "huddle:end requires a room_id")
    huddle = (
        state.huddles.get(cmd.room_id) if hasattr(state, "huddles") else None
    )
    if huddle is None:
        return []
    return [
        _envelope(
            cmd,
            type="huddle.end",
            content={"huddle_id": huddle["huddle_id"]},
            room_id=cmd.room_id,
        )
    ]


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------


def _resolve_staging(cmd: Command, state: ProjectedState, channel_id: str) -> str:
    ch = state.channels.get(channel_id)
    if ch is None:
        raise CommandRejected("not_found", f"Unknown channel {channel_id}")
    return str(ch.get("staging_policy", "agent-messages-require-approval"))


def handle_chat_send_message(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "chat:send-message requires a room_id")
    _require_channel_membership(cmd, state, cmd.room_id)

    payload = cmd.payload
    if not (payload.get("content") or payload.get("attachments")):
        raise CommandRejected("invalid_payload", "Either content or attachments must be present")

    mentions = list(payload.get("mentions") or [])
    if mentions:
        ws_members = state.workspace_members.get(cmd.workspace_id, {})
        for uid in mentions:
            if uid not in ws_members:
                raise CommandRejected("invalid_payload", f"Cannot mention non-member {uid}")

    # Validate thread_root references an existing message in this channel.
    thread_root = payload.get("thread_root")
    if thread_root is not None:
        root = state.messages.get(thread_root)
        if root is None:
            raise CommandRejected("invalid_payload", f"Unknown thread root {thread_root}")
        if root["channel_id"] != cmd.room_id:
            raise CommandRejected("invalid_payload", "thread_root belongs to a different channel")

    staging = _resolve_staging(cmd, state, cmd.room_id)
    requires_approval = (
        staging == "all-require-approval"
        or (staging == "agent-messages-require-approval" and cmd.source == "agent")
    )
    if requires_approval and cmd.source == "agent":
        return _build_proposal(cmd, payload)

    msg_envelope = _envelope(cmd, type="message.send", content=payload, room_id=cmd.room_id)
    out: list[EventEnvelope] = [msg_envelope]
    for uid in mentions:
        if uid == cmd.actor_id:
            continue
        out.append(
            EventEnvelope(
                event_id=make_event_id(),
                type="notification.create",
                content={
                    "user_id": uid,
                    "notification_id": make_notification_id(),
                    "kind": "mention",
                    "target_event_id": msg_envelope.event_id,
                    "body": (payload.get("content") or "")[:200],
                },
                workspace_id=cmd.workspace_id,
                room_id=cmd.room_id,
                sender_id=cmd.actor_id,
                sender_type=cmd.source,
                idempotency_key=cmd.idempotency_key,
            )
        )
    return out


def handle_chat_edit_message(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    target_id = cmd.payload.get("target_event_id") or cmd.payload.get("event_id")
    new_content = cmd.payload.get("new_content")
    if not target_id or new_content is None:
        raise CommandRejected("invalid_payload", "target_event_id and new_content required")
    msg = state.messages.get(target_id)
    if msg is None:
        raise CommandRejected("not_found", f"Unknown message {target_id}")
    if msg["sender_id"] != cmd.actor_id and cmd.source != "system":
        raise CommandRejected("forbidden", "Only the original sender can edit a message")
    if msg.get("redacted"):
        raise CommandRejected("conflict", "Cannot edit a redacted message")
    return [
        _envelope(
            cmd,
            type="message.edit",
            content={
                "content": new_content,
                **({"mentions": cmd.payload["mentions"]} if "mentions" in cmd.payload else {}),
            },
            room_id=msg["channel_id"],
            relates_to=RelatesTo(event_id=target_id, rel_type="m.replace"),
        )
    ]


def handle_chat_delete_message(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    target_id = cmd.payload.get("target_event_id") or cmd.payload.get("event_id")
    if not target_id:
        raise CommandRejected("invalid_payload", "target_event_id required")
    msg = state.messages.get(target_id)
    if msg is None:
        raise CommandRejected("not_found", f"Unknown message {target_id}")
    workspace_member = state.workspace_members.get(cmd.workspace_id, {}).get(cmd.actor_id)
    is_admin = workspace_member is not None and workspace_member.get("role") in {"owner", "admin"}
    if msg["sender_id"] != cmd.actor_id and not is_admin:
        raise CommandRejected("forbidden", "Only sender or admin can redact")
    return [
        _envelope(
            cmd,
            type="message.redact",
            content={"reason": cmd.payload.get("reason")},
            room_id=msg["channel_id"],
            relates_to=RelatesTo(event_id=target_id, rel_type="m.redact"),
        )
    ]


def handle_chat_add_reaction(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    target_id = cmd.payload.get("target_event_id") or cmd.payload.get("event_id")
    if not target_id:
        raise CommandRejected("invalid_payload", "target_event_id required")
    msg = state.messages.get(target_id)
    if msg is None:
        raise CommandRejected("not_found", f"Unknown message {target_id}")
    return [
        _envelope(
            cmd,
            type="reaction.add",
            content={"emoji": cmd.payload["emoji"]},
            room_id=msg["channel_id"],
            relates_to=RelatesTo(event_id=target_id, rel_type="m.reaction"),
        )
    ]


def handle_chat_remove_reaction(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    target_id = cmd.payload.get("target_event_id") or cmd.payload.get("event_id")
    if not target_id:
        raise CommandRejected("invalid_payload", "target_event_id required")
    msg = state.messages.get(target_id)
    if msg is None:
        raise CommandRejected("not_found", f"Unknown message {target_id}")
    return [
        _envelope(
            cmd,
            type="reaction.remove",
            content={"emoji": cmd.payload["emoji"]},
            room_id=msg["channel_id"],
            relates_to=RelatesTo(event_id=target_id, rel_type="m.reaction"),
        )
    ]


def handle_chat_mark_read(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    up_to_event_id = cmd.payload["up_to_event_id"]
    msg = state.messages.get(up_to_event_id)
    if msg is None:
        raise CommandRejected("not_found", f"Unknown message {up_to_event_id}")
    return [
        _envelope(
            cmd,
            type="read.marker",
            content={"up_to_sequence": int(msg["sequence"]), "up_to_event_id": up_to_event_id},
            room_id=msg["channel_id"],
        )
    ]


def handle_chat_mark_unread(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    """Move the actor's read marker to *just before* the target message.

    Re-emits a ``read.marker`` event whose ``up_to_sequence`` is one less
    than the target. The projector takes the maximum, so to move backwards
    we have to clobber the user's marker entry directly (the projector
    refuses to regress). Concretely, we encode the desired backward move
    as a fresh marker at ``target.sequence - 1``; the WS gateway pushes
    it down and the frontend reduces accordingly.
    """
    target_event_id = cmd.payload.get("target_event_id")
    if not target_event_id:
        raise CommandRejected("invalid_payload", "target_event_id required")
    msg = state.messages.get(target_event_id)
    if msg is None:
        raise CommandRejected("not_found", f"Unknown message {target_event_id}")
    new_seq = max(0, int(msg["sequence"]) - 1)
    # Emit a `read.marker` carrying the new (lower) sequence. The projector
    # itself only moves the marker forward; the frontend `setReadUpTo`
    # reducer accepts arbitrary values, so the round-trip works for the
    # active session. Cross-session rewinds are by design uncommon.
    return [
        _envelope(
            cmd,
            type="read.marker",
            content={"up_to_sequence": new_seq, "up_to_event_id": target_event_id, "rewind": True},
            room_id=msg["channel_id"],
        )
    ]


def handle_chat_star_message(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    target_id = cmd.payload.get("target_event_id")
    if not target_id:
        raise CommandRejected("invalid_payload", "target_event_id required")
    msg = state.messages.get(target_id)
    if msg is None or msg.get("redacted"):
        raise CommandRejected("not_found", f"Unknown message {target_id}")
    _require_channel_membership(cmd, state, msg["channel_id"])
    return [
        _envelope(
            cmd,
            type="message.starred",
            content={"target_event_id": target_id},
            room_id=msg["channel_id"],
        )
    ]


def handle_chat_unstar_message(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    target_id = cmd.payload.get("target_event_id")
    if not target_id:
        raise CommandRejected("invalid_payload", "target_event_id required")
    msg = state.messages.get(target_id)
    if msg is None:
        raise CommandRejected("not_found", f"Unknown message {target_id}")
    return [
        _envelope(
            cmd,
            type="message.unstarred",
            content={"target_event_id": target_id},
            room_id=msg["channel_id"],
        )
    ]


def handle_chat_set_notification_pref(
    cmd: Command, state: ProjectedState
) -> list[EventEnvelope]:
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "chat:set-notification-pref requires a room_id")
    _require_channel_membership(cmd, state, cmd.room_id)
    mode = cmd.payload.get("mode", "all")
    if mode not in {"all", "mentions", "none"}:
        raise CommandRejected("invalid_payload", "mode must be all|mentions|none")
    return [
        _envelope(
            cmd,
            type="channel.notification.set",
            content={"mode": mode},
            room_id=cmd.room_id,
        )
    ]


def handle_link_unfurl(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    """Persist a freshly-fetched link unfurl into the event log.

    The HTTP fetch happens in the function-layer (`link:unfurl`) which
    only dispatches this command after a successful resolution. We keep
    the projector update in the log so replays + WS-push are uniform.
    """
    payload = dict(cmd.payload)
    url = payload.get("url")
    if not url:
        raise CommandRejected("invalid_payload", "url required")
    return [
        _envelope(
            cmd,
            type="link.unfurl",
            content=payload,
            room_id=cmd.room_id or cmd.workspace_id,
        )
    ]


# ---------------------------------------------------------------------------
# Agent staging
# ---------------------------------------------------------------------------


def _build_proposal(cmd: Command, payload: dict[str, Any]) -> list[EventEnvelope]:
    proposal_id = make_proposal_id()
    env = EventEnvelope(
        event_id=make_event_id(),
        type="agent.proposal.create",
        content={
            "proposal_id": proposal_id,
            "command_type": cmd.type,
            "payload": payload,
            "rationale": cmd.payload.get("rationale"),
        },
        workspace_id=cmd.workspace_id,
        room_id=cmd.room_id or "",
        sender_id=cmd.actor_id,
        sender_type=cmd.source,
        agent_id=cmd.agent_id,
        idempotency_key=cmd.idempotency_key,
    )
    env.extra["staged"] = proposal_id
    return [env]


def handle_agent_propose_message(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    if cmd.source != "agent":
        raise CommandRejected("forbidden", "Only agents can propose messages")
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "agent:propose-message requires a room_id")
    return _build_proposal(cmd, dict(cmd.payload))


def handle_agent_approve_proposal(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    proposal = state.proposals.get(cmd.payload["proposal_id"])
    if proposal is None or proposal["status"] != "pending":
        raise CommandRejected("conflict", "Proposal is not pending")
    return [
        _envelope(
            cmd,
            type="agent.proposal.approve",
            content={"proposal_id": proposal["id"]},
            room_id=proposal["channel_id"],
        ),
        # Materialise the underlying message — sender is the agent, but
        # the *approval* is auditable on the bus' command_id.
        EventEnvelope(
            event_id=make_event_id(),
            type="message.send",
            content=proposal["payload"],
            workspace_id=cmd.workspace_id,
            room_id=proposal["channel_id"],
            sender_id=proposal.get("agent_id") or proposal["payload"].get("sender_id", cmd.actor_id),
            sender_type="agent",
            agent_id=proposal.get("agent_id"),
            idempotency_key=cmd.idempotency_key,
        ),
    ]


def handle_agent_reject_proposal(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    proposal = state.proposals.get(cmd.payload["proposal_id"])
    if proposal is None or proposal["status"] != "pending":
        raise CommandRejected("conflict", "Proposal is not pending")
    return [
        _envelope(
            cmd,
            type="agent.proposal.reject",
            content={"proposal_id": proposal["id"], "reason": cmd.payload.get("reason")},
            room_id=proposal["channel_id"],
        )
    ]


def handle_agent_edit_and_approve(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    proposal = state.proposals.get(cmd.payload["proposal_id"])
    if proposal is None or proposal["status"] != "pending":
        raise CommandRejected("conflict", "Proposal is not pending")
    edited = cmd.payload.get("edited_payload") or {}
    merged = {**proposal["payload"], **edited}
    return [
        _envelope(
            cmd,
            type="agent.proposal.edit-and-approve",
            content={"proposal_id": proposal["id"], "edited_payload": merged},
            room_id=proposal["channel_id"],
        ),
        EventEnvelope(
            event_id=make_event_id(),
            type="message.send",
            content=merged,
            workspace_id=cmd.workspace_id,
            room_id=proposal["channel_id"],
            sender_id=proposal.get("agent_id") or cmd.actor_id,
            sender_type="agent",
            agent_id=proposal.get("agent_id"),
            idempotency_key=cmd.idempotency_key,
        ),
    ]


# ---------------------------------------------------------------------------
# DMs
# ---------------------------------------------------------------------------


def handle_dm_open(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    _require_workspace_membership(cmd, state)
    requested = list(cmd.payload.get("participant_ids") or [])
    # "Notes to self" — the caller passes only their own user id (or
    # nothing). We materialise this as a single-member DM channel so
    # the UI can render it the same way as any other DM (sidebar row,
    # composer, scheduled messages, search) without a special path.
    is_notes_to_self = (
        not requested
        or set(requested) == {cmd.actor_id}
    )
    if is_notes_to_self:
        sorted_participants = [cmd.actor_id]
    else:
        if cmd.actor_id not in requested:
            requested.append(cmd.actor_id)
        sorted_participants = sorted(set(requested))
        if len(sorted_participants) < 2:
            raise CommandRejected("invalid_payload", "DM requires at least 2 participants")

    workspace_members = state.workspace_members.get(cmd.workspace_id, {})
    for uid in sorted_participants:
        if uid not in workspace_members:
            raise CommandRejected("invalid_payload", f"DM participant {uid} is not a workspace member")

    key = "|".join(sorted_participants)
    existing_channel_id = state.dm_index.get(key)
    if existing_channel_id is not None:
        # Idempotent: return no events; caller can read the channel id from
        # the projection.
        env = EventEnvelope(
            event_id=make_event_id(),
            type="dm.create",
            content={"participant_ids": sorted_participants, "existed": True},
            workspace_id=cmd.workspace_id,
            room_id=existing_channel_id,
            sender_id=cmd.actor_id,
            sender_type=cmd.source,
            idempotency_key=cmd.idempotency_key,
        )
        env.extra["noop"] = True
        env.extra["dm_channel_id"] = existing_channel_id
        return []

    channel_id = make_dm_channel_id(sorted_participants)
    # 1:1 DMs are `dm`; everything bigger (the user + 2+ others) is a
    # `group_dm` so the UI renders an avatar cluster + member name list
    # instead of pretending to be a 1:1 conversation with the first peer.
    # Notes-to-self uses `dm` too so the picker / row UI just works
    # (one participant, the user themselves).
    channel_type = "group_dm" if len(sorted_participants) > 2 else "dm"
    out: list[EventEnvelope] = [
        EventEnvelope(
            event_id=make_event_id(),
            type="channel.create",
            content={
                "name": f"DM {channel_id}",
                "type": channel_type,
                "private": True,
                "staging_policy": "agent-messages-require-approval",
            },
            workspace_id=cmd.workspace_id,
            room_id=channel_id,
            sender_id=cmd.actor_id,
            sender_type=cmd.source,
            idempotency_key=cmd.idempotency_key,
        )
    ]
    for uid in sorted_participants:
        out.append(
            EventEnvelope(
                event_id=make_event_id(),
                type="channel.member.join",
                content={"user_id": uid},
                workspace_id=cmd.workspace_id,
                room_id=channel_id,
                sender_id=cmd.actor_id,
                sender_type=cmd.source,
                idempotency_key=cmd.idempotency_key,
            )
        )
    out.append(
        EventEnvelope(
            event_id=make_event_id(),
            type="dm.create",
            content={"participant_ids": sorted_participants},
            workspace_id=cmd.workspace_id,
            room_id=channel_id,
            sender_id=cmd.actor_id,
            sender_type=cmd.source,
            idempotency_key=cmd.idempotency_key,
        )
    )
    return out


# ---------------------------------------------------------------------------
# Scheduled messages + reminders
# ---------------------------------------------------------------------------


def handle_chat_schedule_message(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    if cmd.room_id is None:
        raise CommandRejected("invalid_command", "chat:schedule-message requires a room_id")
    _require_channel_membership(cmd, state, cmd.room_id)
    fire_at = cmd.payload.get("fire_at")
    inner_payload = cmd.payload.get("payload") or {}
    if not fire_at:
        raise CommandRejected("invalid_payload", "fire_at required")
    if not (inner_payload.get("content") or inner_payload.get("attachments")):
        raise CommandRejected("invalid_payload", "scheduled message must carry content or attachments")
    return [
        _envelope(
            cmd,
            type="message.scheduled.set",
            content={
                "scheduled_id": make_scheduled_id(),
                "target_room_id": cmd.room_id,
                "payload": inner_payload,
                "fire_at": int(fire_at),
            },
            room_id=cmd.room_id,
        )
    ]


def handle_chat_cancel_scheduled(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    sched = state.scheduled_messages.get(cmd.payload.get("scheduled_id"))
    if sched is None:
        raise CommandRejected("not_found", "Unknown scheduled message")
    if sched["created_by"] != cmd.actor_id:
        raise CommandRejected("forbidden", "Only the original author can cancel a scheduled message")
    if sched["status"] != "pending":
        raise CommandRejected("conflict", "Scheduled message is no longer pending")
    return [
        _envelope(
            cmd,
            type="message.scheduled.cancel",
            content={"scheduled_id": sched["id"]},
            room_id=sched["channel_id"],
        )
    ]


def handle_chat_set_reminder(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    target_event_id = cmd.payload.get("target_event_id")
    fire_at = cmd.payload.get("fire_at")
    if not target_event_id or not fire_at:
        raise CommandRejected("invalid_payload", "target_event_id + fire_at required")
    msg = state.messages.get(target_event_id)
    if msg is None:
        raise CommandRejected("not_found", "Unknown message")
    return [
        _envelope(
            cmd,
            type="message.reminder.set",
            content={
                "reminder_id": make_reminder_id(),
                "target_event_id": target_event_id,
                "fire_at": int(fire_at),
            },
            room_id=msg["channel_id"],
        )
    ]


def handle_chat_cancel_reminder(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    rem = state.reminders.get(cmd.payload.get("reminder_id"))
    if rem is None:
        raise CommandRejected("not_found", "Unknown reminder")
    if rem["owner_id"] != cmd.actor_id:
        raise CommandRejected("forbidden", "Only the reminder owner can cancel it")
    if rem["status"] != "pending":
        raise CommandRejected("conflict", "Reminder is no longer pending")
    return [
        _envelope(
            cmd,
            type="message.reminder.cancel",
            content={"reminder_id": rem["id"]},
            room_id=rem["channel_id"],
        )
    ]


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


def handle_notifications_mark_read(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    notif_id = cmd.payload.get("notification_id")
    if not notif_id:
        raise CommandRejected("invalid_payload", "notification_id required")
    user_notifs = state.notifications.get(cmd.actor_id, {})
    if notif_id not in user_notifs:
        raise CommandRejected("not_found", "Unknown notification")
    return [
        _envelope(
            cmd,
            type="notification.read",
            content={"notification_id": notif_id},
            room_id=user_notifs[notif_id]["channel_id"],
        )
    ]


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


def register_default_handlers(bus: CommandBus) -> CommandBus:
    bus.register("workspace:create", handle_workspace_create)
    bus.register("workspace:invite", handle_workspace_invite)
    bus.register("workspace:set-role", handle_workspace_set_role)
    bus.register("channel:create", handle_channel_create)
    bus.register("channel:invite", handle_channel_invite)
    bus.register("channel:set-topic", handle_channel_set_topic)
    bus.register("channel:update", handle_channel_update)
    bus.register("channel:archive", handle_channel_archive)
    bus.register("channel:unarchive", handle_channel_unarchive)
    bus.register("channel:leave", handle_channel_leave)
    bus.register("channel:kick", handle_channel_kick)
    bus.register("chat:send-message", handle_chat_send_message)
    bus.register("chat:edit-message", handle_chat_edit_message)
    bus.register("chat:delete-message", handle_chat_delete_message)
    bus.register("chat:add-reaction", handle_chat_add_reaction)
    bus.register("chat:remove-reaction", handle_chat_remove_reaction)
    bus.register("chat:mark-read", handle_chat_mark_read)
    bus.register("chat:pin-message", handle_chat_pin_message)
    bus.register("chat:unpin-message", handle_chat_unpin_message)
    bus.register("chat:set-draft", handle_chat_set_draft)
    bus.register("chat:clear-draft", handle_chat_clear_draft)
    bus.register("user:set-status", handle_user_set_status)
    bus.register("user:set-presence", handle_user_set_presence)
    bus.register("user:snooze-notifications", handle_user_snooze)
    bus.register("user:set-display-name", handle_user_set_display_name)
    bus.register("huddle:start", handle_huddle_start)
    bus.register("huddle:join", handle_huddle_join)
    bus.register("huddle:leave", handle_huddle_leave)
    bus.register("huddle:end", handle_huddle_end)
    bus.register("agent:propose-message", handle_agent_propose_message)
    bus.register("agent:approve-proposal", handle_agent_approve_proposal)
    bus.register("agent:reject-proposal", handle_agent_reject_proposal)
    bus.register("agent:edit-and-approve-proposal", handle_agent_edit_and_approve)
    bus.register("dm:open", handle_dm_open)
    bus.register("chat:schedule-message", handle_chat_schedule_message)
    bus.register("chat:cancel-scheduled", handle_chat_cancel_scheduled)
    bus.register("chat:set-reminder", handle_chat_set_reminder)
    bus.register("chat:cancel-reminder", handle_chat_cancel_reminder)
    bus.register("notifications:mark-read", handle_notifications_mark_read)
    bus.register("chat:mark-unread", handle_chat_mark_unread)
    bus.register("chat:star-message", handle_chat_star_message)
    bus.register("chat:unstar-message", handle_chat_unstar_message)
    bus.register("chat:set-notification-pref", handle_chat_set_notification_pref)
    bus.register("link:unfurl", handle_link_unfurl)
    return bus
