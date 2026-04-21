"""Materialise committed events into the projection tables.

The pure ``project_event`` in ``projector.py`` keeps an in-memory
``ProjectedState`` (used by handlers for authorisation + by tests). For
read endpoints to work in production — and so a fresh dev process can
recover state without replaying the entire log into Python — we also
need rows in the SQL projection tables (``workspaces``,
``workspace_members``, ``channels``, ``channel_members``, ``messages``,
``proposals``, …).

Production hof-engine deployments typically run this in a separate
Celery worker that tails the event log. For the in-process dev path
(and so ``make seed`` can rely on the same code path), this module
exposes ``write_projection(session, event)`` which the
``PostgresCommitter`` calls inside the same transaction that wrote the
event row. That keeps the projection consistent with the log without
introducing a second worker.

Only the event types the standalone web demo + agent inbox actually
read are covered here. Anything else is a no-op; the in-memory
projector still handles them for command-bus authorisation. Add new
handlers as new read endpoints land.
"""

from __future__ import annotations

import json
from typing import Any, Callable

from sqlalchemy import text
from sqlalchemy.orm import Session

from .model import Event


def _jsonify(value: Any) -> str:
    """Serialise a Python value to a JSON string for `CAST(:p AS jsonb)`.

    psycopg2/psycopg3 won't auto-adapt raw dicts/lists through SQLAlchemy
    `text(...)` placeholders, so every projection write that targets a
    JSONB column hands Postgres a string and casts on the SQL side.
    """
    return json.dumps(value if value is not None else None)


def write_projection(session: Session, event: Event) -> None:
    """Apply ``event`` to the projection tables, if it's a type we project.

    Idempotent on ``event_id`` for the few tables that key on it; the
    structural ``ON CONFLICT DO NOTHING`` / ``DO UPDATE`` clauses below
    keep replays safe.
    """
    handler = _DISPATCH.get(event.type)
    if handler is None:
        return
    handler(session, event)


def _project_workspace_create(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            INSERT INTO workspaces (id, workspace_id, name, slug, icon, created_at, created_by)
            VALUES (gen_random_uuid(), :wid, :name, :slug, :icon, :ts, :sender)
            ON CONFLICT (workspace_id) DO UPDATE
              SET name = EXCLUDED.name,
                  slug = EXCLUDED.slug,
                  icon = EXCLUDED.icon
            """
        ),
        {
            "wid": e.workspace_id,
            "name": e.content.get("name", "Untitled workspace"),
            "slug": e.content.get("slug"),
            "icon": e.content.get("icon"),
            "ts": e.origin_ts,
            "sender": e.sender_id,
        },
    )


def _project_workspace_member_add(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            INSERT INTO workspace_members (id, workspace_id, user_id, role, joined_at)
            VALUES (gen_random_uuid(), :wid, :uid, :role, :ts)
            ON CONFLICT (workspace_id, user_id) DO UPDATE
              SET role = EXCLUDED.role
            """
        ),
        {
            "wid": e.workspace_id,
            "uid": e.content["user_id"],
            "role": e.content.get("role", "member"),
            "ts": e.origin_ts,
        },
    )


def _project_workspace_member_role_set(s: Session, e: Event) -> None:
    s.execute(
        text(
            "UPDATE workspace_members SET role = :role WHERE workspace_id = :wid AND user_id = :uid"
        ),
        {
            "wid": e.workspace_id,
            "uid": e.content["user_id"],
            "role": e.content["role"],
        },
    )


def _project_channel_create(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            INSERT INTO channels (id, channel_id, workspace_id, name, type, private, topic,
                                  description, staging_policy, slow_mode_seconds, archived,
                                  created_at, created_by)
            VALUES (gen_random_uuid(), :cid, :wid, :name, :type, :private, :topic, :description,
                    :staging, :slow, FALSE, :ts, :sender)
            ON CONFLICT (channel_id) DO UPDATE
              SET name = EXCLUDED.name,
                  type = EXCLUDED.type,
                  private = EXCLUDED.private,
                  topic = EXCLUDED.topic,
                  description = EXCLUDED.description,
                  staging_policy = EXCLUDED.staging_policy
            """
        ),
        {
            "cid": e.room_id,
            "wid": e.workspace_id,
            "name": e.content.get("name") or e.room_id,
            "type": e.content.get("type", "public"),
            "private": bool(e.content.get("private", False)),
            "topic": e.content.get("topic"),
            "description": e.content.get("description"),
            "staging": e.content.get("staging_policy", "agent-messages-require-approval"),
            "slow": int(e.content.get("slow_mode_seconds") or 0),
            "ts": e.origin_ts,
            "sender": e.sender_id,
        },
    )


def _project_channel_member_join(s: Session, e: Event) -> None:
    user_id = e.content.get("user_id", e.sender_id)
    s.execute(
        text(
            """
            INSERT INTO channel_members (id, channel_id, user_id, joined_at, role)
            VALUES (gen_random_uuid(), :cid, :uid, :ts, 'member')
            ON CONFLICT (channel_id, user_id) DO NOTHING
            """
        ),
        {"cid": e.room_id, "uid": user_id, "ts": e.origin_ts},
    )


def _project_channel_member_invite(s: Session, e: Event) -> None:
    for uid in e.content.get("user_ids", []):
        s.execute(
            text(
                """
                INSERT INTO channel_members (id, channel_id, user_id, joined_at, role)
                VALUES (gen_random_uuid(), :cid, :uid, :ts, 'member')
                ON CONFLICT (channel_id, user_id) DO NOTHING
                """
            ),
            {"cid": e.room_id, "uid": uid, "ts": e.origin_ts},
        )


def _project_channel_topic_set(s: Session, e: Event) -> None:
    s.execute(
        text("UPDATE channels SET topic = :topic WHERE channel_id = :cid"),
        {"topic": e.content.get("topic"), "cid": e.room_id},
    )


def _project_channel_update(s: Session, e: Event) -> None:
    """Update mutable channel metadata. Only fields present in the payload
    are touched; missing fields stay at their current value."""
    sets: list[str] = []
    params: dict[str, Any] = {"cid": e.room_id}
    for key in ("name", "topic", "description", "staging_policy", "slow_mode_seconds"):
        if key in e.content:
            sets.append(f"{key} = :{key}")
            params[key] = e.content[key]
    if not sets:
        return
    s.execute(text(f"UPDATE channels SET {', '.join(sets)} WHERE channel_id = :cid"), params)


def _project_channel_archive(s: Session, e: Event) -> None:
    s.execute(
        text("UPDATE channels SET archived = TRUE WHERE channel_id = :cid"),
        {"cid": e.room_id},
    )


def _project_channel_unarchive(s: Session, e: Event) -> None:
    s.execute(
        text("UPDATE channels SET archived = FALSE WHERE channel_id = :cid"),
        {"cid": e.room_id},
    )


def _project_channel_member_leave(s: Session, e: Event) -> None:
    user_id = e.content.get("user_id", e.sender_id)
    s.execute(
        text("DELETE FROM channel_members WHERE channel_id = :cid AND user_id = :uid"),
        {"cid": e.room_id, "uid": user_id},
    )


def _project_channel_member_kick(s: Session, e: Event) -> None:
    s.execute(
        text("DELETE FROM channel_members WHERE channel_id = :cid AND user_id = :uid"),
        {"cid": e.room_id, "uid": e.content["user_id"]},
    )


def _project_channel_pin_add(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            INSERT INTO pinned (id, channel_id, message_id, pinned_at, pinned_by)
            VALUES (gen_random_uuid(), :cid, :mid, :ts, :sender)
            ON CONFLICT (channel_id, message_id) DO NOTHING
            """
        ),
        {
            "cid": e.room_id,
            "mid": e.content["message_id"],
            "ts": e.origin_ts,
            "sender": e.sender_id,
        },
    )


def _project_channel_pin_remove(s: Session, e: Event) -> None:
    s.execute(
        text("DELETE FROM pinned WHERE channel_id = :cid AND message_id = :mid"),
        {"cid": e.room_id, "mid": e.content["message_id"]},
    )


def _project_message_send(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            INSERT INTO messages (id, message_id, workspace_id, channel_id, thread_root,
                                  sender_id, sender_type, agent_id, content, mentions,
                                  attachments, edited_at, redacted, sequence, created_at)
            VALUES (gen_random_uuid(), :mid, :wid, :cid, :thread, :sender, :stype, :agent,
                    :content, CAST(:mentions AS jsonb), CAST(:attachments AS jsonb),
                    NULL, FALSE, :seq, :ts)
            ON CONFLICT (message_id) DO NOTHING
            """
        ),
        {
            "mid": e.event_id,
            "wid": e.workspace_id,
            "cid": e.room_id,
            "thread": e.content.get("thread_root"),
            "sender": e.sender_id,
            "stype": e.sender_type,
            "agent": e.agent_id,
            "content": e.content.get("content", ""),
            "mentions": _jsonify(list(e.content.get("mentions") or [])),
            "attachments": _jsonify(list(e.content.get("attachments") or [])),
            "seq": e.sequence,
            "ts": e.origin_ts,
        },
    )


def _project_message_edit(s: Session, e: Event) -> None:
    target = e.relates_to.event_id if e.relates_to else None
    if not target:
        return
    if "mentions" in e.content:
        s.execute(
            text(
                """
                UPDATE messages
                SET content = :content,
                    mentions = CAST(:mentions AS jsonb),
                    edited_at = :ts
                WHERE message_id = :mid AND redacted = FALSE
                """
            ),
            {
                "mid": target,
                "content": e.content.get("content", ""),
                "mentions": _jsonify(list(e.content.get("mentions") or [])),
                "ts": e.origin_ts,
            },
        )
    else:
        s.execute(
            text(
                """
                UPDATE messages
                SET content = :content, edited_at = :ts
                WHERE message_id = :mid AND redacted = FALSE
                """
            ),
            {"mid": target, "content": e.content.get("content", ""), "ts": e.origin_ts},
        )


def _project_message_redact(s: Session, e: Event) -> None:
    target = e.relates_to.event_id if e.relates_to else None
    if not target:
        return
    s.execute(
        text(
            """
            UPDATE messages
            SET redacted = TRUE,
                redact_reason = :reason,
                content = '',
                mentions = '[]',
                attachments = '[]'
            WHERE message_id = :mid
            """
        ),
        {"mid": target, "reason": e.content.get("reason")},
    )


def _project_reaction_add(s: Session, e: Event) -> None:
    target = e.relates_to.event_id if e.relates_to else None
    if not target:
        return
    s.execute(
        text(
            """
            INSERT INTO reactions (id, message_id, emoji, user_id, added_at)
            VALUES (gen_random_uuid(), :mid, :emoji, :uid, :ts)
            ON CONFLICT (message_id, emoji, user_id) DO NOTHING
            """
        ),
        {
            "mid": target,
            "emoji": e.content["emoji"],
            "uid": e.sender_id,
            "ts": e.origin_ts,
        },
    )


def _project_reaction_remove(s: Session, e: Event) -> None:
    target = e.relates_to.event_id if e.relates_to else None
    if not target:
        return
    s.execute(
        text(
            """
            DELETE FROM reactions
            WHERE message_id = :mid AND emoji = :emoji AND user_id = :uid
            """
        ),
        {
            "mid": target,
            "emoji": e.content["emoji"],
            "uid": e.sender_id,
        },
    )


def _project_read_marker(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            INSERT INTO read_markers (id, user_id, channel_id, up_to_sequence)
            VALUES (gen_random_uuid(), :uid, :cid, :seq)
            ON CONFLICT (user_id, channel_id) DO UPDATE
              SET up_to_sequence = GREATEST(read_markers.up_to_sequence, EXCLUDED.up_to_sequence)
            """
        ),
        {
            "uid": e.sender_id,
            "cid": e.room_id,
            "seq": int(e.content.get("up_to_sequence") or e.sequence),
        },
    )


def _project_draft_set(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            INSERT INTO drafts (id, user_id, channel_id, thread_root, content, updated_at)
            VALUES (gen_random_uuid(), :uid, :cid, :thread, :content, :ts)
            ON CONFLICT (user_id, channel_id) DO UPDATE
              SET content = EXCLUDED.content,
                  thread_root = EXCLUDED.thread_root,
                  updated_at = EXCLUDED.updated_at
            """
        ),
        {
            "uid": e.sender_id,
            "cid": e.room_id,
            "thread": e.content.get("thread_root"),
            "content": e.content.get("content", ""),
            "ts": e.origin_ts,
        },
    )


def _project_draft_clear(s: Session, e: Event) -> None:
    s.execute(
        text("DELETE FROM drafts WHERE user_id = :uid AND channel_id = :cid"),
        {"uid": e.sender_id, "cid": e.room_id},
    )


def _project_dm_create(s: Session, e: Event) -> None:
    """DMs reuse the channels table; the `dm.create` event is the marker
    that the room is a DM. We only need to ensure the row is flagged
    correctly (channel.create already handled the bulk)."""
    s.execute(
        text(
            "UPDATE channels SET type = 'dm', private = TRUE WHERE channel_id = :cid"
        ),
        {"cid": e.room_id},
    )


def _project_notification_create(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            INSERT INTO notifications (id, notification_id, user_id, workspace_id,
                                       channel_id, kind, target_event_id, body,
                                       created_at, read_at)
            VALUES (gen_random_uuid(), :nid, :uid, :wid, :cid, :kind, :target,
                    :body, :ts, NULL)
            ON CONFLICT (notification_id) DO NOTHING
            """
        ),
        {
            "nid": e.content["notification_id"],
            "uid": e.content["user_id"],
            "wid": e.workspace_id,
            "cid": e.room_id,
            "kind": e.content.get("kind", "mention"),
            "target": e.content.get("target_event_id"),
            "body": e.content.get("body"),
            "ts": e.origin_ts,
        },
    )


def _project_notification_read(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            UPDATE notifications
            SET read_at = :ts
            WHERE notification_id = :nid AND user_id = :uid AND read_at IS NULL
            """
        ),
        {
            "nid": e.content["notification_id"],
            "uid": e.sender_id,
            "ts": e.origin_ts,
        },
    )


def _project_proposal_create(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            INSERT INTO proposals (id, proposal_id, workspace_id, channel_id, agent_id,
                                   command_type, payload, rationale, status, created_at)
            VALUES (gen_random_uuid(), :pid, :wid, :cid, :agent, :ctype,
                    CAST(:payload AS jsonb), :rationale, 'pending', :ts)
            ON CONFLICT (proposal_id) DO NOTHING
            """
        ),
        {
            "pid": e.content["proposal_id"],
            "wid": e.workspace_id,
            "cid": e.room_id,
            "agent": e.agent_id,
            "ctype": e.content.get("command_type"),
            "payload": _jsonify(e.content.get("payload", {})),
            "rationale": e.content.get("rationale"),
            "ts": e.origin_ts,
        },
    )


def _project_proposal_approve(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            UPDATE proposals
            SET status = 'approved', resolved_at = :ts, resolved_by = :sender
            WHERE proposal_id = :pid AND status = 'pending'
            """
        ),
        {"pid": e.content["proposal_id"], "ts": e.origin_ts, "sender": e.sender_id},
    )


def _project_proposal_reject(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            UPDATE proposals
            SET status = 'rejected',
                resolved_at = :ts,
                resolved_by = :sender,
                reject_reason = :reason
            WHERE proposal_id = :pid AND status = 'pending'
            """
        ),
        {
            "pid": e.content["proposal_id"],
            "ts": e.origin_ts,
            "sender": e.sender_id,
            "reason": e.content.get("reason"),
        },
    )


def _project_proposal_edit_and_approve(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            UPDATE proposals
            SET status = 'edited',
                resolved_at = :ts,
                resolved_by = :sender,
                edited_payload = CAST(:payload AS jsonb)
            WHERE proposal_id = :pid AND status = 'pending'
            """
        ),
        {
            "pid": e.content["proposal_id"],
            "ts": e.origin_ts,
            "sender": e.sender_id,
            "payload": _jsonify(e.content.get("edited_payload") or {}),
        },
    )


def _project_huddle_start(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            INSERT INTO huddles (id, huddle_id, workspace_id, channel_id,
                                 livekit_room, started_by, started_at,
                                 ended_at, title)
            VALUES (gen_random_uuid(), :hid, :wid, :cid, :room, :sender,
                    :ts, NULL, :title)
            ON CONFLICT (huddle_id) DO NOTHING
            """
        ),
        {
            "hid": e.content["huddle_id"],
            "wid": e.workspace_id,
            "cid": e.room_id,
            "room": e.content.get("livekit_room", e.content["huddle_id"]),
            "sender": e.sender_id,
            "ts": e.origin_ts,
            "title": e.content.get("title"),
        },
    )
    s.execute(
        text(
            """
            INSERT INTO huddle_participants (id, huddle_id, user_id, joined_at, left_at, role)
            VALUES (gen_random_uuid(), :hid, :uid, :ts, NULL, 'host')
            ON CONFLICT (huddle_id, user_id) DO NOTHING
            """
        ),
        {"hid": e.content["huddle_id"], "uid": e.sender_id, "ts": e.origin_ts},
    )


def _project_huddle_join(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            INSERT INTO huddle_participants (id, huddle_id, user_id, joined_at, left_at, role)
            VALUES (gen_random_uuid(), :hid, :uid, :ts, NULL, 'guest')
            ON CONFLICT (huddle_id, user_id) DO UPDATE
              SET joined_at = LEAST(huddle_participants.joined_at, EXCLUDED.joined_at),
                  left_at = NULL
            """
        ),
        {"hid": e.content["huddle_id"], "uid": e.sender_id, "ts": e.origin_ts},
    )


def _project_huddle_leave(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            UPDATE huddle_participants
            SET left_at = :ts
            WHERE huddle_id = :hid AND user_id = :uid AND left_at IS NULL
            """
        ),
        {"hid": e.content["huddle_id"], "uid": e.sender_id, "ts": e.origin_ts},
    )


def _project_huddle_end(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            UPDATE huddles SET ended_at = :ts
            WHERE huddle_id = :hid AND ended_at IS NULL
            """
        ),
        {"hid": e.content["huddle_id"], "ts": e.origin_ts},
    )
    s.execute(
        text(
            """
            UPDATE huddle_participants SET left_at = :ts
            WHERE huddle_id = :hid AND left_at IS NULL
            """
        ),
        {"hid": e.content["huddle_id"], "ts": e.origin_ts},
    )


def _project_agent_register(s: Session, e: Event) -> None:
    s.execute(
        text(
            """
            INSERT INTO agents (id, agent_id, workspace_id, display_name, scopes,
                                registered_at, registered_by)
            VALUES (gen_random_uuid(), :aid, :wid, :name, CAST(:scopes AS jsonb),
                    :ts, :sender)
            ON CONFLICT (agent_id) DO UPDATE
              SET display_name = EXCLUDED.display_name,
                  scopes = EXCLUDED.scopes
            """
        ),
        {
            "aid": e.content["agent_id"],
            "wid": e.workspace_id,
            "name": e.content.get("display_name", e.content["agent_id"]),
            "scopes": _jsonify(list(e.content.get("scopes", []))),
            "ts": e.origin_ts,
            "sender": e.sender_id,
        },
    )


def _project_user_display_name_set(s: Session, e: Event) -> None:
    """Mirror a `user.display-name.set` event onto the `users` table.

    The function endpoint already writes the row inline (so anonymous
    bootstrapping works without a workspace context); this writer keeps
    the SQL projection consistent when the event arrives via replay or
    when a separate process consumes the log.
    """
    s.execute(
        text(
            """
            INSERT INTO users (id, user_id, display_name, is_anonymous)
            VALUES (gen_random_uuid(), :user_id, :display_name, TRUE)
            ON CONFLICT (user_id) DO UPDATE
              SET display_name = EXCLUDED.display_name
            """
        ),
        {"user_id": e.sender_id, "display_name": e.content.get("display_name", e.sender_id)},
    )


_DISPATCH: dict[str, Callable[[Session, Event], None]] = {
    "workspace.create": _project_workspace_create,
    "workspace.member.add": _project_workspace_member_add,
    "workspace.member.role-set": _project_workspace_member_role_set,
    "channel.create": _project_channel_create,
    "channel.update": _project_channel_update,
    "channel.archive": _project_channel_archive,
    "channel.unarchive": _project_channel_unarchive,
    "channel.member.join": _project_channel_member_join,
    "channel.member.invite": _project_channel_member_invite,
    "channel.member.leave": _project_channel_member_leave,
    "channel.member.kick": _project_channel_member_kick,
    "channel.pin.add": _project_channel_pin_add,
    "channel.pin.remove": _project_channel_pin_remove,
    "channel.topic.set": _project_channel_topic_set,
    "message.send": _project_message_send,
    "message.edit": _project_message_edit,
    "message.redact": _project_message_redact,
    "reaction.add": _project_reaction_add,
    "reaction.remove": _project_reaction_remove,
    "read.marker": _project_read_marker,
    "draft.set": _project_draft_set,
    "draft.clear": _project_draft_clear,
    "dm.create": _project_dm_create,
    "notification.create": _project_notification_create,
    "notification.read": _project_notification_read,
    "agent.identity.register": _project_agent_register,
    "agent.proposal.create": _project_proposal_create,
    "agent.proposal.approve": _project_proposal_approve,
    "agent.proposal.reject": _project_proposal_reject,
    "agent.proposal.edit-and-approve": _project_proposal_edit_and_approve,
    "huddle.start": _project_huddle_start,
    "huddle.join": _project_huddle_join,
    "huddle.leave": _project_huddle_leave,
    "huddle.end": _project_huddle_end,
    "user.display-name.set": _project_user_display_name_set,
}
