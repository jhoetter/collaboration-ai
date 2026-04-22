"""Pure projection engine.

Replaying any event log through ``project_log`` MUST produce the exact
same ``ProjectedState`` every time. This is the event-sourcing integrity
bar from prompt.md ("Given the same event log, every replay produces the
same state"). Every test under ``tests/integration/events/`` exercises
this property.

Design notes:

* ``ProjectedState`` is a plain set of dictionaries keyed by id; nothing
  references the database. The hof-engine projection table writers in
  ``domain/events/projector_runner.py`` derive their rows by calling the
  same per-event functions on a state proxy that translates dict mutations
  into SQL upserts.
* Each projection function is **idempotent** — applying the same event
  twice (because of an at-least-once retry) leaves the state unchanged.
  Idempotency keys are matched on ``event_id`` so that even pure-Python
  state stays correct on replays.
* Edits and redactions are applied in *causal* order using
  ``relates_to.event_id``: an edit of an unknown message is skipped and
  re-tried on later replays once the parent has been seen (i.e. logs
  must be replayed in sequence order, which the loader enforces).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from .model import Event, RelatesTo, is_known_event_type


@dataclass(slots=True)
class ProjectedState:
    """Snapshot of derived state. Every field is plain Python (no SQL)."""

    workspaces: dict[str, dict[str, Any]] = field(default_factory=dict)
    workspace_members: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    """``workspace_members[workspace_id][user_id] = {role, joined_at, …}``."""

    channels: dict[str, dict[str, Any]] = field(default_factory=dict)
    channel_members: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    """``channel_members[channel_id][user_id] = {joined_at, role, …}``."""

    messages: dict[str, dict[str, Any]] = field(default_factory=dict)
    """Keyed by event_id. ``redacted: bool`` and ``edited_at`` track edits."""

    reactions: dict[str, dict[str, set[str]]] = field(default_factory=dict)
    """``reactions[message_id][emoji] = set(user_ids)``."""

    read_markers: dict[str, dict[str, int]] = field(default_factory=dict)
    """``read_markers[user_id][channel_id] = up_to_sequence``."""

    pinned: dict[str, set[str]] = field(default_factory=dict)
    """``pinned[channel_id] = set(message_event_ids)``."""

    drafts: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    """``drafts[user_id][channel_id] = {content, updated_at, thread_root}``."""

    user_status: dict[str, dict[str, Any]] = field(default_factory=dict)
    user_presence: dict[str, dict[str, Any]] = field(default_factory=dict)
    snoozed_until: dict[str, int] = field(default_factory=dict)

    agents: dict[str, dict[str, Any]] = field(default_factory=dict)
    proposals: dict[str, dict[str, Any]] = field(default_factory=dict)
    """Keyed by proposal id. ``status`` ∈ pending|approved|rejected|edited."""

    notifications: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    """``notifications[user_id][notification_id] = {…, read: bool}``."""

    scheduled_messages: dict[str, dict[str, Any]] = field(default_factory=dict)
    """``scheduled_messages[scheduled_id] = {payload, fire_at, status}``."""

    reminders: dict[str, dict[str, Any]] = field(default_factory=dict)
    """``reminders[reminder_id] = {target_event_id, fire_at, status}``."""

    dm_index: dict[str, str] = field(default_factory=dict)
    """``dm_index[<sorted-participants-hash>] = channel_id``."""

    huddles: dict[str, dict[str, Any]] = field(default_factory=dict)
    """Active huddle keyed by ``channel_id``. Cleared on ``huddle.end``.
    Shape: ``{huddle_id, livekit_room, started_by, started_at,
    title, ended_at, participants: set[str]}``."""

    starred_by_message: dict[str, set[str]] = field(default_factory=dict)
    """``starred_by_message[message_id] = set(user_ids)``."""

    stars_by_user: dict[str, list[str]] = field(default_factory=dict)
    """``stars_by_user[user_id] = [message_id, …]`` ordered most-recent first."""

    notification_prefs: dict[str, dict[str, str]] = field(default_factory=dict)
    """``notification_prefs[user_id][channel_id] = "all" | "mentions" | "none"``."""

    link_unfurls: dict[str, dict[str, Any]] = field(default_factory=dict)
    """``link_unfurls[url] = {title, description, image_url, site_name, fetched_at}``."""

    # Bookkeeping for idempotent replay.
    _seen_event_ids: set[str] = field(default_factory=set)
    last_sequence: dict[str, int] = field(default_factory=dict)
    """``last_sequence[workspace_id] = highest committed sequence``."""


# ---------------------------------------------------------------------------
# Per-type projection functions
# ---------------------------------------------------------------------------


def _ensure(d: dict[str, Any], key: str, default: Any) -> Any:
    if key not in d:
        d[key] = default
    return d[key]


def _project_workspace_create(s: ProjectedState, e: Event) -> None:
    s.workspaces[e.workspace_id] = {
        "id": e.workspace_id,
        "name": e.content.get("name", "Untitled workspace"),
        "slug": e.content.get("slug"),
        "created_at": e.origin_ts,
        "created_by": e.sender_id,
    }
    _ensure(s.workspace_members, e.workspace_id, {})


def _project_workspace_update(s: ProjectedState, e: Event) -> None:
    ws = s.workspaces.get(e.workspace_id)
    if ws is None:
        return
    for key in ("name", "slug", "icon"):
        if key in e.content:
            ws[key] = e.content[key]


def _project_workspace_member_add(s: ProjectedState, e: Event) -> None:
    members = _ensure(s.workspace_members, e.workspace_id, {})
    user_id = e.content["user_id"]
    members[user_id] = {
        "user_id": user_id,
        "role": e.content.get("role", "member"),
        "joined_at": e.origin_ts,
        "added_by": e.sender_id,
    }


def _project_workspace_member_remove(s: ProjectedState, e: Event) -> None:
    members = s.workspace_members.get(e.workspace_id, {})
    members.pop(e.content["user_id"], None)


def _project_workspace_member_role_set(s: ProjectedState, e: Event) -> None:
    members = s.workspace_members.get(e.workspace_id, {})
    member = members.get(e.content["user_id"])
    if member is not None:
        member["role"] = e.content["role"]


def _project_channel_create(s: ProjectedState, e: Event) -> None:
    s.channels[e.room_id] = {
        "id": e.room_id,
        "workspace_id": e.workspace_id,
        "name": e.content.get("name") or e.room_id,
        "type": e.content.get("type", "public"),
        "private": bool(e.content.get("private", False)),
        "topic": e.content.get("topic"),
        "description": e.content.get("description"),
        "created_at": e.origin_ts,
        "created_by": e.sender_id,
        "archived": False,
        "staging_policy": e.content.get("staging_policy", "agent-messages-require-approval"),
        "slow_mode_seconds": int(e.content.get("slow_mode_seconds") or 0),
    }
    _ensure(s.channel_members, e.room_id, {})


def _project_channel_update(s: ProjectedState, e: Event) -> None:
    ch = s.channels.get(e.room_id)
    if ch is None:
        return
    for key in ("name", "topic", "description", "staging_policy", "slow_mode_seconds"):
        if key in e.content:
            ch[key] = e.content[key]


def _project_channel_archive(s: ProjectedState, e: Event) -> None:
    ch = s.channels.get(e.room_id)
    if ch is not None:
        ch["archived"] = True


def _project_channel_unarchive(s: ProjectedState, e: Event) -> None:
    ch = s.channels.get(e.room_id)
    if ch is not None:
        ch["archived"] = False


def _project_channel_member_join(s: ProjectedState, e: Event) -> None:
    members = _ensure(s.channel_members, e.room_id, {})
    user_id = e.content.get("user_id", e.sender_id)
    if user_id not in members:
        members[user_id] = {"user_id": user_id, "joined_at": e.origin_ts}


def _project_channel_member_leave(s: ProjectedState, e: Event) -> None:
    members = s.channel_members.get(e.room_id, {})
    user_id = e.content.get("user_id", e.sender_id)
    members.pop(user_id, None)


def _project_channel_member_invite(s: ProjectedState, e: Event) -> None:
    members = _ensure(s.channel_members, e.room_id, {})
    for user_id in e.content.get("user_ids", []):
        if user_id not in members:
            members[user_id] = {
                "user_id": user_id,
                "joined_at": e.origin_ts,
                "invited_by": e.sender_id,
            }


def _project_channel_member_kick(s: ProjectedState, e: Event) -> None:
    members = s.channel_members.get(e.room_id, {})
    members.pop(e.content["user_id"], None)


def _project_channel_pin_add(s: ProjectedState, e: Event) -> None:
    pins = _ensure(s.pinned, e.room_id, set())
    pins.add(e.content["message_id"])


def _project_channel_pin_remove(s: ProjectedState, e: Event) -> None:
    pins = s.pinned.get(e.room_id, set())
    pins.discard(e.content["message_id"])


def _project_channel_topic_set(s: ProjectedState, e: Event) -> None:
    ch = s.channels.get(e.room_id)
    if ch is not None:
        ch["topic"] = e.content.get("topic")


def _project_message_send(s: ProjectedState, e: Event) -> None:
    thread_root = e.content.get("thread_root")
    s.messages[e.event_id] = {
        "id": e.event_id,
        "workspace_id": e.workspace_id,
        "channel_id": e.room_id,
        "thread_root": thread_root,
        "sender_id": e.sender_id,
        "sender_type": e.sender_type,
        "agent_id": e.agent_id,
        "content": e.content.get("content", ""),
        "mentions": list(e.content.get("mentions") or []),
        "mentions_special": list(e.content.get("mentions_special") or []),
        "attachments": list(e.content.get("attachments") or []),
        "created_at": e.origin_ts,
        "edited_at": None,
        "redacted": False,
        "redact_reason": None,
        "sequence": e.sequence,
        "thread_reply_count": 0,
        "thread_last_reply_ts": None,
    }
    if thread_root and thread_root in s.messages:
        root = s.messages[thread_root]
        root["thread_reply_count"] = int(root.get("thread_reply_count") or 0) + 1
        root["thread_last_reply_ts"] = e.origin_ts


def _project_message_edit(s: ProjectedState, e: Event) -> None:
    rt = e.relates_to
    if rt is None:
        return
    msg = s.messages.get(rt.event_id)
    if msg is None or msg.get("redacted"):
        return
    msg["content"] = e.content.get("content", msg["content"])
    msg["edited_at"] = e.origin_ts
    if "mentions" in e.content:
        msg["mentions"] = list(e.content["mentions"])
    msg.setdefault("edits", []).append(
        {
            "event_id": e.event_id,
            "edited_by": e.sender_id,
            "edited_at": e.origin_ts,
        }
    )


def _project_message_redact(s: ProjectedState, e: Event) -> None:
    rt = e.relates_to
    if rt is None:
        return
    msg = s.messages.get(rt.event_id)
    if msg is None:
        return
    msg["redacted"] = True
    msg["redact_reason"] = e.content.get("reason")
    msg["content"] = ""
    msg["mentions"] = []
    msg["attachments"] = []
    s.reactions.pop(rt.event_id, None)
    pins = s.pinned.get(msg["channel_id"], set())
    pins.discard(rt.event_id)


def _project_reaction_add(s: ProjectedState, e: Event) -> None:
    rt = e.relates_to
    if rt is None:
        return
    msg = s.messages.get(rt.event_id)
    if msg is None or msg.get("redacted"):
        return
    by_msg = _ensure(s.reactions, rt.event_id, {})
    by_emoji = _ensure(by_msg, e.content["emoji"], set())
    by_emoji.add(e.sender_id)


def _project_reaction_remove(s: ProjectedState, e: Event) -> None:
    rt = e.relates_to
    if rt is None:
        return
    by_msg = s.reactions.get(rt.event_id)
    if by_msg is None:
        return
    by_emoji = by_msg.get(e.content["emoji"])
    if by_emoji is None:
        return
    by_emoji.discard(e.sender_id)
    if not by_emoji:
        by_msg.pop(e.content["emoji"], None)
    if not by_msg:
        s.reactions.pop(rt.event_id, None)


def _project_read_marker(s: ProjectedState, e: Event) -> None:
    user_markers = _ensure(s.read_markers, e.sender_id, {})
    current = user_markers.get(e.room_id, 0)
    candidate = int(e.content.get("up_to_sequence", e.sequence))
    if candidate > current:
        user_markers[e.room_id] = candidate


def _project_draft_set(s: ProjectedState, e: Event) -> None:
    user_drafts = _ensure(s.drafts, e.sender_id, {})
    user_drafts[e.room_id] = {
        "content": e.content.get("content", ""),
        "thread_root": e.content.get("thread_root"),
        "updated_at": e.origin_ts,
    }


def _project_draft_clear(s: ProjectedState, e: Event) -> None:
    user_drafts = s.drafts.get(e.sender_id, {})
    user_drafts.pop(e.room_id, None)


def _project_user_status_set(s: ProjectedState, e: Event) -> None:
    s.user_status[e.sender_id] = {
        "emoji": e.content.get("emoji"),
        "text": e.content.get("text"),
        "clear_at": e.content.get("clear_at"),
        "set_at": e.origin_ts,
    }


def _project_user_presence_set(s: ProjectedState, e: Event) -> None:
    s.user_presence[e.sender_id] = {
        "status": e.content.get("status", "active"),
        "until": e.content.get("until"),
        "set_at": e.origin_ts,
    }


def _project_user_snooze_set(s: ProjectedState, e: Event) -> None:
    until = e.content.get("until")
    if until is not None:
        s.snoozed_until[e.sender_id] = int(until)
    else:
        s.snoozed_until.pop(e.sender_id, None)


def _project_agent_register(s: ProjectedState, e: Event) -> None:
    agent_id = e.content["agent_id"]
    s.agents[agent_id] = {
        "agent_id": agent_id,
        "workspace_id": e.workspace_id,
        "display_name": e.content.get("display_name", agent_id),
        "scopes": list(e.content.get("scopes", [])),
        "registered_at": e.origin_ts,
        "registered_by": e.sender_id,
    }


def _project_proposal_create(s: ProjectedState, e: Event) -> None:
    proposal_id = e.content["proposal_id"]
    s.proposals[proposal_id] = {
        "id": proposal_id,
        "workspace_id": e.workspace_id,
        "channel_id": e.room_id,
        "command_type": e.content.get("command_type"),
        "payload": e.content.get("payload", {}),
        "rationale": e.content.get("rationale"),
        "agent_id": e.agent_id,
        "created_at": e.origin_ts,
        "status": "pending",
    }


def _project_proposal_approve(s: ProjectedState, e: Event) -> None:
    p = s.proposals.get(e.content["proposal_id"])
    if p is None or p["status"] != "pending":
        return
    p["status"] = "approved"
    p["resolved_at"] = e.origin_ts
    p["resolved_by"] = e.sender_id


def _project_proposal_reject(s: ProjectedState, e: Event) -> None:
    p = s.proposals.get(e.content["proposal_id"])
    if p is None or p["status"] != "pending":
        return
    p["status"] = "rejected"
    p["resolved_at"] = e.origin_ts
    p["resolved_by"] = e.sender_id
    p["reject_reason"] = e.content.get("reason")


def _project_proposal_edit_and_approve(s: ProjectedState, e: Event) -> None:
    p = s.proposals.get(e.content["proposal_id"])
    if p is None or p["status"] != "pending":
        return
    p["status"] = "edited"
    p["resolved_at"] = e.origin_ts
    p["resolved_by"] = e.sender_id
    p["edited_payload"] = e.content.get("edited_payload")


def _project_dm_create(s: ProjectedState, e: Event) -> None:
    participants = sorted(e.content.get("participant_ids", []))
    if not participants:
        return
    key = "|".join(participants)
    s.dm_index[key] = e.room_id


def _project_message_scheduled_set(s: ProjectedState, e: Event) -> None:
    sched_id = e.content["scheduled_id"]
    s.scheduled_messages[sched_id] = {
        "id": sched_id,
        "workspace_id": e.workspace_id,
        "channel_id": e.content.get("target_room_id") or e.room_id,
        "payload": e.content.get("payload", {}),
        "fire_at": int(e.content["fire_at"]),
        "created_at": e.origin_ts,
        "created_by": e.sender_id,
        "status": "pending",
    }


def _project_message_scheduled_cancel(s: ProjectedState, e: Event) -> None:
    sched = s.scheduled_messages.get(e.content["scheduled_id"])
    if sched is not None and sched["status"] == "pending":
        sched["status"] = "cancelled"
        sched["cancelled_at"] = e.origin_ts


def _project_message_scheduled_fired(s: ProjectedState, e: Event) -> None:
    sched = s.scheduled_messages.get(e.content["scheduled_id"])
    if sched is not None and sched["status"] == "pending":
        sched["status"] = "fired"
        sched["fired_at"] = e.origin_ts


def _project_message_reminder_set(s: ProjectedState, e: Event) -> None:
    rem_id = e.content["reminder_id"]
    s.reminders[rem_id] = {
        "id": rem_id,
        "workspace_id": e.workspace_id,
        "channel_id": e.room_id,
        "target_event_id": e.content.get("target_event_id"),
        "fire_at": int(e.content["fire_at"]),
        "owner_id": e.sender_id,
        "status": "pending",
    }


def _project_message_reminder_cancel(s: ProjectedState, e: Event) -> None:
    rem = s.reminders.get(e.content["reminder_id"])
    if rem is not None and rem["status"] == "pending":
        rem["status"] = "cancelled"


def _project_message_reminder_fired(s: ProjectedState, e: Event) -> None:
    rem = s.reminders.get(e.content["reminder_id"])
    if rem is not None and rem["status"] == "pending":
        rem["status"] = "fired"
        rem["fired_at"] = e.origin_ts


def _project_notification_create(s: ProjectedState, e: Event) -> None:
    user_id = e.content["user_id"]
    notif_id = e.content["notification_id"]
    user_notifs = _ensure(s.notifications, user_id, {})
    user_notifs[notif_id] = {
        "id": notif_id,
        "workspace_id": e.workspace_id,
        "channel_id": e.room_id,
        "kind": e.content.get("kind", "mention"),
        "target_event_id": e.content.get("target_event_id"),
        "body": e.content.get("body"),
        "created_at": e.origin_ts,
        "read": False,
    }


def _project_notification_read(s: ProjectedState, e: Event) -> None:
    user_id = e.sender_id
    notif_id = e.content["notification_id"]
    user_notifs = s.notifications.get(user_id, {})
    notif = user_notifs.get(notif_id)
    if notif is not None:
        notif["read"] = True
        notif["read_at"] = e.origin_ts


def _project_user_display_name_set(s: ProjectedState, e: Event) -> None:
    # Display-name updates are surfaced through the `users` projection
    # table (written by `projection_writer.py`); we keep no in-memory
    # mirror because nothing in `ProjectedState` reads it back.
    return


def _project_huddle_start(s: ProjectedState, e: Event) -> None:
    s.huddles[e.room_id] = {
        "huddle_id": e.content["huddle_id"],
        "channel_id": e.room_id,
        "livekit_room": e.content.get("livekit_room", e.content["huddle_id"]),
        "started_by": e.sender_id,
        "started_at": e.origin_ts,
        "ended_at": None,
        "participants": {e.sender_id},
        "title": e.content.get("title"),
    }


def _project_huddle_join(s: ProjectedState, e: Event) -> None:
    h = s.huddles.get(e.room_id)
    if h is None or h.get("ended_at"):
        return
    h["participants"].add(e.sender_id)


def _project_huddle_leave(s: ProjectedState, e: Event) -> None:
    h = s.huddles.get(e.room_id)
    if h is None:
        return
    h["participants"].discard(e.sender_id)


def _project_huddle_end(s: ProjectedState, e: Event) -> None:
    h = s.huddles.get(e.room_id)
    if h is None:
        return
    h["ended_at"] = e.origin_ts
    s.huddles.pop(e.room_id, None)


def _project_message_starred(s: ProjectedState, e: Event) -> None:
    target = e.content.get("target_event_id")
    if not target:
        return
    by_msg = _ensure(s.starred_by_message, target, set())
    if e.sender_id in by_msg:
        return
    by_msg.add(e.sender_id)
    user_stars = _ensure(s.stars_by_user, e.sender_id, [])
    if target not in user_stars:
        user_stars.insert(0, target)


def _project_message_unstarred(s: ProjectedState, e: Event) -> None:
    target = e.content.get("target_event_id")
    if not target:
        return
    by_msg = s.starred_by_message.get(target)
    if by_msg:
        by_msg.discard(e.sender_id)
        if not by_msg:
            s.starred_by_message.pop(target, None)
    user_stars = s.stars_by_user.get(e.sender_id)
    if user_stars and target in user_stars:
        user_stars.remove(target)


def _project_channel_notification_set(s: ProjectedState, e: Event) -> None:
    user_prefs = _ensure(s.notification_prefs, e.sender_id, {})
    mode = e.content.get("mode", "all")
    if mode == "all":
        user_prefs.pop(e.room_id, None)
    else:
        user_prefs[e.room_id] = mode


def _project_link_unfurl(s: ProjectedState, e: Event) -> None:
    url = e.content.get("url")
    if not url:
        return
    s.link_unfurls[url] = {
        "url": url,
        "title": e.content.get("title"),
        "description": e.content.get("description"),
        "image_url": e.content.get("image_url"),
        "site_name": e.content.get("site_name"),
        "fetched_at": e.origin_ts,
    }


_DISPATCH: dict[str, Callable[[ProjectedState, Event], None]] = {
    "workspace.create": _project_workspace_create,
    "workspace.update": _project_workspace_update,
    "workspace.member.add": _project_workspace_member_add,
    "workspace.member.remove": _project_workspace_member_remove,
    "workspace.member.role-set": _project_workspace_member_role_set,
    "channel.create": _project_channel_create,
    "channel.update": _project_channel_update,
    "channel.archive": _project_channel_archive,
    "channel.unarchive": _project_channel_unarchive,
    "channel.member.join": _project_channel_member_join,
    "channel.member.leave": _project_channel_member_leave,
    "channel.member.invite": _project_channel_member_invite,
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
    "user.status.set": _project_user_status_set,
    "user.presence.set": _project_user_presence_set,
    "user.snooze.set": _project_user_snooze_set,
    "agent.identity.register": _project_agent_register,
    "agent.proposal.create": _project_proposal_create,
    "agent.proposal.approve": _project_proposal_approve,
    "agent.proposal.reject": _project_proposal_reject,
    "agent.proposal.edit-and-approve": _project_proposal_edit_and_approve,
    "dm.create": _project_dm_create,
    "message.scheduled.set": _project_message_scheduled_set,
    "message.scheduled.cancel": _project_message_scheduled_cancel,
    "message.scheduled.fired": _project_message_scheduled_fired,
    "message.reminder.set": _project_message_reminder_set,
    "message.reminder.cancel": _project_message_reminder_cancel,
    "message.reminder.fired": _project_message_reminder_fired,
    "notification.create": _project_notification_create,
    "notification.read": _project_notification_read,
    "user.display-name.set": _project_user_display_name_set,
    "huddle.start": _project_huddle_start,
    "huddle.join": _project_huddle_join,
    "huddle.leave": _project_huddle_leave,
    "huddle.end": _project_huddle_end,
    "message.starred": _project_message_starred,
    "message.unstarred": _project_message_unstarred,
    "channel.notification.set": _project_channel_notification_set,
    "link.unfurl": _project_link_unfurl,
}


def project_event(state: ProjectedState, event: Event) -> ProjectedState:
    """Apply a single event to the running state.

    Idempotent on ``event_id``: replaying an event that has already been
    seen is a no-op. Events with unknown types are silently skipped (so
    rolling forward through a partially-deployed schema is safe); the
    table-layer `Event` row keeps the raw payload either way.
    """
    if event.event_id in state._seen_event_ids:
        return state
    if not is_known_event_type(event.type):
        return state
    handler = _DISPATCH.get(event.type)
    if handler is None:
        return state
    handler(state, event)
    state._seen_event_ids.add(event.event_id)
    last = state.last_sequence.get(event.workspace_id, 0)
    if event.sequence > last:
        state.last_sequence[event.workspace_id] = event.sequence
    return state


def project_log(events: list[Event]) -> ProjectedState:
    """Replay a (sequence-ordered) log into a fresh ``ProjectedState``."""
    state = ProjectedState()
    # Sort by (workspace_id, sequence) defensively so callers don't have
    # to. Within a workspace the projector requires sequence order; across
    # workspaces ordering is irrelevant.
    ordered = sorted(events, key=lambda e: (e.workspace_id, e.sequence))
    for e in ordered:
        project_event(state, e)
    return state


def relates_to(event_id: str, rel_type: str) -> RelatesTo:
    """Tiny helper used by tests + command bus to build relates-to refs."""
    return RelatesTo(event_id=event_id, rel_type=rel_type)  # type: ignore[arg-type]
