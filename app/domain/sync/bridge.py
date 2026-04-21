"""Process-wide fanout registry.

The committer publishes every freshly-appended event into the
``InProcessFanout`` exposed here; the WS gateway reads from the same
instance to push frames over `/ws/events`. Keeping the registry in a
dedicated module (rather than constructing the fanout in
``runtime.py``) avoids an import cycle: ``sync.ws_gateway`` already
depends on the fanout module, and ``runtime`` already depends on the
committer.

A test harness can inject its own fanout (or ``None`` to disable
publishing) via ``set_fanout``.
"""

from __future__ import annotations

from typing import Optional

from .fanout import Fanout, InProcessFanout

_fanout: Optional[Fanout] = None


def set_fanout(fanout: Optional[Fanout]) -> None:
    global _fanout
    _fanout = fanout


def get_fanout() -> Fanout:
    """Return the registered fanout, lazily creating an in-process one.

    Production wiring (``functions/register.py``) sets this explicitly
    before the API starts serving so the WS gateway and the committer
    share the same instance. Tests that don't care about realtime can
    let this lazy-create — they still get a working fanout object.
    """
    global _fanout
    if _fanout is None:
        _fanout = InProcessFanout()
    return _fanout
