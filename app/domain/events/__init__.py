"""Event taxonomy + projection engine.

The event log is the **source of truth** for collaboration-ai. Every other
piece of state (channels, messages, memberships, reactions, read markers,
proposals, …) is a deterministic projection of the log.

This package contains:

* ``model``      – the typed ``Event`` envelope and the registered event
                   types (``EVENT_TYPES``); pure Python, no hof-engine.
* ``projector``  – a dispatch table from event type to a small pure
                   function that mutates a ``ProjectedState`` in place.
                   Replaying the log from scratch through ``project_log``
                   yields identical state on every run.
* ``ids``        – stable id helpers (UUIDv7-flavoured monotonic ids so
                   the on-the-wire ordering matches sequence ordering).
* ``table``      – the hof-engine ``Event`` Table that persists rows.
                   Imported lazily to keep this package usable in unit
                   tests without a hof-engine install.
"""

from .model import (
    EVENT_TYPES,
    Event,
    EventEnvelope,
    EventType,
    SenderType,
    is_known_event_type,
)
from .projector import ProjectedState, project_event, project_log

__all__ = [
    "EVENT_TYPES",
    "Event",
    "EventEnvelope",
    "EventType",
    "ProjectedState",
    "SenderType",
    "is_known_event_type",
    "project_event",
    "project_log",
]
