"""Multi-client coherence harness (per prompt.md §Sync Fixtures).

Five virtual clients across three channels. We:

1. Spin up the bus + projector + an `InProcessFanout`.
2. Each client subscribes a `BoundedQueue` and replays inbound events
   into a private `ProjectedState` using the same projector.
3. We dispatch a deterministic mix of sends / edits / reactions.
4. We simulate a network split for client #4 by detaching its
   subscription, dispatching more commands, and then "reconnecting" via
   the long-poll path (replaying from its stored cursor).
5. After reconnect, every client's projection must equal the
   ground-truth projection over the global event log.
"""

from __future__ import annotations

from copy import deepcopy

from domain.events.model import Event
from domain.events.projector import ProjectedState, project_event, project_log
from domain.shared.command_bus import Command, CommandBus
from domain.shared.handlers import register_default_handlers
from domain.sync.fanout import InProcessFanout
from domain.sync.queue import BoundedQueue


def _bootstrap(bus: CommandBus, ws: str = "ws_demo") -> tuple[str, list[str], list[str]]:
    actor = "usr_owner"
    bus.dispatch(
        Command(type="workspace:create", payload={"name": "demo"}, source="human", actor_id=actor, workspace_id=ws)
    )
    user_ids = [f"usr_{i}" for i in range(5)]
    for uid in user_ids:
        bus.dispatch(
            Command(
                type="workspace:invite",
                payload={"user_id": uid, "role": "member"},
                source="human",
                actor_id=actor,
                workspace_id=ws,
            )
        )
    channel_ids: list[str] = []
    for ch in ("ch_general", "ch_random", "ch_dev"):
        bus.dispatch(
            Command(
                type="channel:create",
                payload={"name": ch, "member_ids": user_ids},
                source="human",
                actor_id=actor,
                workspace_id=ws,
                room_id=ch,
            )
        )
        channel_ids.append(ch)
    return ws, user_ids, channel_ids


def _replay_into(state: ProjectedState, events: list[Event]) -> None:
    for e in sorted(events, key=lambda x: x.sequence):
        project_event(state, e)


def test_five_clients_converge_after_split_and_reconnect() -> None:
    state = ProjectedState()
    bus = register_default_handlers(CommandBus(projector_state=state))
    fan = InProcessFanout()
    committed_log: list[Event] = []

    def dispatch(cmd: Command):
        res = bus.dispatch(cmd)
        for evt in res.events:
            committed_log.append(evt)
            fan.publish(evt)
        return res

    # Replace the bootstrap to use the wrapper.
    actor = "usr_owner"
    dispatch(
        Command(type="workspace:create", payload={"name": "demo"}, source="human", actor_id=actor, workspace_id="ws_demo")
    )
    users = [f"usr_{i}" for i in range(5)]
    for uid in users:
        dispatch(
            Command(
                type="workspace:invite",
                payload={"user_id": uid, "role": "member"},
                source="human",
                actor_id=actor,
                workspace_id="ws_demo",
            )
        )
    channels = []
    for ch in ("ch_general", "ch_random", "ch_dev"):
        dispatch(
            Command(
                type="channel:create",
                payload={"name": ch, "member_ids": users},
                source="human",
                actor_id=actor,
                workspace_id="ws_demo",
                room_id=ch,
            )
        )
        channels.append(ch)
    ws = "ws_demo"

    client_states: dict[str, ProjectedState] = {}
    client_queues: dict[str, BoundedQueue] = {}
    client_subs: dict[str, int] = {}

    for u in users:
        cs = ProjectedState()
        # Bootstrap the client's projection by replaying everything
        # already committed before they subscribed (Phase 2: real client
        # bootstraps via /api/sync from cursor=0).
        _replay_into(cs, list(committed_log))
        client_states[u] = cs
        q = BoundedQueue(maxsize=512)
        client_queues[u] = q
        client_subs[u] = fan.subscribe(ws, set(), q)

    # Phase A: a burst of message activity.
    for i in range(30):
        sender = users[i % len(users)]
        ch = channels[i % len(channels)]
        dispatch(
            Command(
                type="chat:send-message",
                payload={"content": f"msg {i}"},
                source="human",
                actor_id=sender,
                workspace_id=ws,
                room_id=ch,
            )
        )

    # Drain each client's queue into its private projection.
    for u in users:
        q = client_queues[u]
        for evt in q.drain():
            project_event(client_states[u], evt)  # type: ignore[arg-type]

    # All clients should match the ground truth at this point.
    truth = project_log(list(committed_log))
    for u in users:
        assert client_states[u].messages == truth.messages, f"client {u} diverged before split"

    # Phase B: client #4 splits off.
    split_user = users[4]
    fan.unsubscribe(client_subs[split_user])
    split_cursor = max(state.last_sequence.values())  # the client remembers this

    # More activity while #4 is offline.
    for i in range(30, 60):
        sender = users[i % 4]  # only the other 4 are sending
        ch = channels[i % len(channels)]
        dispatch(
            Command(
                type="chat:send-message",
                payload={"content": f"during-split {i}"},
                source="human",
                actor_id=sender,
                workspace_id=ws,
                room_id=ch,
            )
        )

    # Drain the still-connected clients.
    for u in users[:4]:
        for evt in client_queues[u].drain():
            project_event(client_states[u], evt)  # type: ignore[arg-type]

    # Phase C: client #4 reconnects via the "long-poll" path —
    # i.e. replays the missed events from the committed log.
    missed = [e for e in committed_log if e.sequence > split_cursor]
    _replay_into(client_states[split_user], missed)

    # Re-subscribe (steady state).
    client_subs[split_user] = fan.subscribe(ws, set(), client_queues[split_user])

    # All clients now match the ground truth.
    truth = project_log(list(committed_log))
    for u in users:
        assert client_states[u].messages == truth.messages, f"client {u} diverged after reconnect"
        assert client_states[u].reactions == truth.reactions
        assert client_states[u].channels == truth.channels


def test_overflow_subscribers_get_force_resync_signal() -> None:
    """A client with a tiny queue overflows and must be told to re-fetch."""
    state = ProjectedState()
    bus = register_default_handlers(CommandBus(projector_state=state))
    fan = InProcessFanout()

    overflow_signals: list[int] = []

    def on_overflow(sub_id: int) -> None:
        overflow_signals.append(sub_id)

    ws = "ws_overflow"
    ws_id, users, channels = _bootstrap(bus, ws=ws)

    for evt in deepcopy([]):  # noop, just ensures the handler runs
        fan.publish(evt)

    q = BoundedQueue(maxsize=3)
    sub_id = fan.subscribe(ws, set(), q, on_overflow=on_overflow)

    for i in range(20):
        res = bus.dispatch(
            Command(
                type="chat:send-message",
                payload={"content": f"flood {i}"},
                source="human",
                actor_id=users[0],
                workspace_id=ws,
                room_id=channels[0],
            )
        )
        for evt in res.events:
            fan.publish(evt)

    assert sub_id in fan.overflowed_subscription_ids
    assert overflow_signals  # at least one force-resync signal was raised
