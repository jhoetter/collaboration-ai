"""The command bus.

`prompt.md` lines 426-446 specify the command/event/result trio. This
module gives them a concrete Python shape and a runtime that:

1. Validates the command's `payload` against its registered schema.
2. Authorises the call against the supplied policy hook.
3. Calls the registered *handler* to produce zero or more
   ``EventEnvelope`` instances.
4. Hands those envelopes to the *committer* — the bridge to the event log
   table — which assigns sequence numbers and persists them atomically.
5. Optionally calls the projector synchronously (small commits) or
   schedules a Celery projection job (large commits).
6. Returns a typed ``CommandResult``.

Everything here is plain Python — no hof-engine, no SQLAlchemy. Real
hof-engine `@function` endpoints under ``app/domain/<entity>/functions.py``
build a `Command`, dispatch it via `CommandBus.dispatch`, and translate
the result into a JSON envelope.

This separation is deliberate: it keeps the bus 100% unit-testable and
keeps every handler (`channel.create`, `message.send`, …) a single pure
function from `(Command, ProjectedState) -> list[EventEnvelope]`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Mapping

from pydantic import ValidationError

from ..events.ids import make_command_id, make_event_id, now_ms
from ..events.model import Event, EventEnvelope
from ..events.payloads import validate_payload
from ..events.projector import ProjectedState, project_event

CommandSource = Literal["human", "agent", "system"]
CommandStatus = Literal["applied", "staged", "rejected", "failed"]


# ---------------------------------------------------------------------------
# Envelope types
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class Command:
    type: str
    payload: dict[str, Any]
    source: CommandSource
    actor_id: str
    workspace_id: str
    session_id: str | None = None
    agent_id: str | None = None
    idempotency_key: str | None = None
    command_id: str = field(default_factory=make_command_id)
    # Optional explicit room id; for many commands the room is derivable
    # from the payload but we let callers pass it through to keep the
    # handler signature uniform.
    room_id: str | None = None


@dataclass(slots=True)
class CommandError:
    code: str
    message: str
    field: str | None = None


@dataclass(slots=True)
class CommandResult:
    command_id: str
    status: CommandStatus
    events: list[Event] = field(default_factory=list)
    proposal_id: str | None = None
    error: CommandError | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "command_id": self.command_id,
            "status": self.status,
            "events": [e.to_dict() for e in self.events],
        }
        if self.proposal_id is not None:
            out["proposal_id"] = self.proposal_id
        if self.error is not None:
            out["error"] = {
                "code": self.error.code,
                "message": self.error.message,
                **({"field": self.error.field} if self.error.field else {}),
            }
        return out


class CommandRejected(Exception):
    """Raised by handlers / authorisers to fail a command cleanly."""

    def __init__(self, code: str, message: str, *, field: str | None = None) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.field = field


# ---------------------------------------------------------------------------
# Handler / committer protocol
# ---------------------------------------------------------------------------


HandlerOutput = list[EventEnvelope]
"""A handler returns the events it would like to emit. The bus assigns
sequences and persists them through ``Committer``."""

Handler = Callable[[Command, ProjectedState], HandlerOutput]
Authoriser = Callable[[Command, ProjectedState], None]


@dataclass(slots=True)
class Committer:
    """Persist a list of envelopes atomically and return committed events.

    In tests this is replaced by an in-memory committer that just assigns
    monotonic sequences. The hof-engine implementation lives in
    ``domain/events/repository.py`` and wraps a Postgres transaction.
    """

    commit: Callable[[list[EventEnvelope]], list[Event]]


@dataclass(slots=True)
class CommandBus:
    handlers: dict[str, Handler] = field(default_factory=dict)
    authorisers: dict[str, Authoriser] = field(default_factory=dict)
    committer: Committer | None = None
    projector_state: ProjectedState | None = None
    """Optional in-memory projection used for read-after-write coherence
    in tests. Production projection happens in a separate Celery worker."""

    # ---- registration ----------------------------------------------------

    def register(
        self,
        command_type: str,
        handler: Handler,
        *,
        authoriser: Authoriser | None = None,
    ) -> None:
        if command_type in self.handlers:
            raise ValueError(f"Handler for {command_type!r} already registered")
        self.handlers[command_type] = handler
        if authoriser is not None:
            self.authorisers[command_type] = authoriser

    def is_registered(self, command_type: str) -> bool:
        return command_type in self.handlers

    # ---- dispatch --------------------------------------------------------

    def dispatch(self, command: Command, *, state: ProjectedState | None = None) -> CommandResult:
        state = state if state is not None else (self.projector_state or ProjectedState())

        handler = self.handlers.get(command.type)
        if handler is None:
            return CommandResult(
                command_id=command.command_id,
                status="rejected",
                error=CommandError(code="unknown_command", message=f"No handler for {command.type!r}"),
            )

        # Pre-validate payload if the command type matches an event type
        # 1:1 (most do — `chat:send-message` -> `message.send`). Handlers
        # are free to do additional validation.
        try:
            for event_type in _matching_event_types(command.type):
                command.payload = validate_payload(event_type, command.payload)
        except ValidationError as exc:
            err = exc.errors()[0]
            return CommandResult(
                command_id=command.command_id,
                status="rejected",
                error=CommandError(
                    code="invalid_payload",
                    message=err.get("msg", "invalid payload"),
                    field=".".join(str(p) for p in err.get("loc", [])),
                ),
            )

        # Authorise.
        try:
            authoriser = self.authorisers.get(command.type)
            if authoriser is not None:
                authoriser(command, state)
        except CommandRejected as rej:
            return CommandResult(
                command_id=command.command_id,
                status="rejected",
                error=CommandError(code=rej.code, message=rej.message, field=rej.field),
            )

        # Build envelopes.
        try:
            envelopes = handler(command, state)
        except CommandRejected as rej:
            return CommandResult(
                command_id=command.command_id,
                status="rejected",
                error=CommandError(code=rej.code, message=rej.message, field=rej.field),
            )

        if not envelopes:
            return CommandResult(command_id=command.command_id, status="applied", events=[])

        # Stamp envelope-level metadata that handlers shouldn't have to
        # set themselves.
        ts = now_ms()
        for env in envelopes:
            if not env.event_id:
                env.event_id = make_event_id()
            if env.idempotency_key is None and command.idempotency_key is not None:
                env.idempotency_key = command.idempotency_key
            if env.workspace_id == "":
                env.workspace_id = command.workspace_id

        # Detect "staged" intent: handler sets ``env.extra['staged'] = proposal_id``.
        proposal_id: str | None = None
        for env in envelopes:
            staged = env.extra.get("staged")
            if staged:
                proposal_id = staged
                break

        # Commit to log.
        if self.committer is None:
            # Test mode — fabricate sequences locally.
            committed = _local_commit(envelopes, state, ts)
        else:
            try:
                committed = self.committer.commit(envelopes)
            except CommandRejected as rej:
                return CommandResult(
                    command_id=command.command_id,
                    status="rejected",
                    error=CommandError(code=rej.code, message=rej.message, field=rej.field),
                )

        # Project synchronously into the in-memory state if one is shared.
        for evt in committed:
            project_event(state, evt)

        return CommandResult(
            command_id=command.command_id,
            status="staged" if proposal_id else "applied",
            events=committed,
            proposal_id=proposal_id,
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


# Mapping of well-known command types to the event type whose Pydantic
# schema validates the same payload. Commands that map 1:1 get free
# payload validation; multi-event commands (e.g. ``channel:create`` emits
# both a `channel.create` and a `channel.member.join`) opt into deeper
# validation inside the handler.
_COMMAND_TO_EVENT: Mapping[str, str] = {
    "workspace:create": "workspace.create",
    "workspace:update": "workspace.update",
    "workspace:invite": "workspace.member.add",
    "workspace:set-role": "workspace.member.role-set",
    "channel:create": "channel.create",
    "channel:update": "channel.update",
    "channel:archive": "channel.archive",
    "channel:unarchive": "channel.unarchive",
    "channel:invite": "channel.member.invite",
    "channel:kick": "channel.member.kick",
    "channel:leave": "channel.member.leave",
    "channel:set-topic": "channel.topic.set",
    "chat:pin-message": "channel.pin.add",
    "chat:unpin-message": "channel.pin.remove",
    "chat:send-message": "message.send",
    # The following commands carry routing metadata (`target_event_id`,
    # `up_to_event_id`) at the command level that doesn't map onto the
    # event payload schema. Their handlers translate the command into the
    # right event content shape and validate the rest by hand.
    # "chat:edit-message" -> (handled in handler, not auto-validated)
    # "chat:delete-message" -> (handled in handler, not auto-validated)
    # "chat:add-reaction" -> (handled in handler, not auto-validated)
    # "chat:remove-reaction" -> (handled in handler, not auto-validated)
    # "chat:mark-read" -> (handled in handler, not auto-validated)
    "chat:set-draft": "draft.set",
    "chat:clear-draft": "draft.clear",
    "user:set-status": "user.status.set",
    "user:set-presence": "user.presence.set",
    "user:snooze-notifications": "user.snooze.set",
    "user:set-display-name": "user.display-name.set",
    # Huddle commands carry only optional metadata (the handler mints
    # the `huddle_id` and `livekit_room`), so they don't auto-validate
    # against the strict event schema. The handler emits well-typed
    # envelopes which projection_writer + projector consume directly.
    # "huddle:start" -> (handled in handler)
    # "huddle:join" -> (handled in handler)
    # "huddle:leave" -> (handled in handler)
    # "huddle:end" -> (handled in handler)
    "agent:propose-message": "agent.proposal.create",
    "agent:approve-proposal": "agent.proposal.approve",
    "agent:reject-proposal": "agent.proposal.reject",
    "agent:edit-and-approve-proposal": "agent.proposal.edit-and-approve",
}


def _matching_event_types(command_type: str) -> list[str]:
    et = _COMMAND_TO_EVENT.get(command_type)
    return [et] if et else []


def _local_commit(envelopes: list[EventEnvelope], state: ProjectedState, ts: int) -> list[Event]:
    """In-memory committer used when ``CommandBus.committer`` is None.

    Assigns workspace-monotonic sequences from ``state.last_sequence``.
    """
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
