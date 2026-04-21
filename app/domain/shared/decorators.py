"""Local `@function` decorator that thinly wraps `hof.function`.

The hof-engine ``function()`` decorator only knows about its own
metadata kwargs (``name``, ``description``, ``tags``, …) and rejects
anything else. Our domain code wants to additionally tag every
function with MCP exposure metadata (``mcp_expose`` + ``mcp_scope``)
so the audit / MCP-bridge code in ``app/domain/agent_api/registry.py``
can decide which functions get re-exposed as MCP tools.

Forwarding those kwargs straight to ``hof.function`` raises
``TypeError`` on import time and silently drops the entire module
from the function registry — which used to leave us with a server
that 404s on every domain endpoint. Wrap it once here, attach the
extra fields as plain attributes on the returned callable, and the
bridge can read them back via ``getattr(fn, "mcp_expose", False)``.
"""

from __future__ import annotations

from typing import Any, Callable

from hof import function as _hof_function


def function(
    fn: Callable[..., Any] | None = None,
    *,
    name: str | None = None,
    description: str | None = None,
    tool_summary: str | None = None,
    when_to_use: str | None = None,
    when_not_to_use: str | None = None,
    related_tools: list[str] | tuple[str, ...] | None = None,
    tags: list[str] | None = None,
    timeout: int = 60,
    retries: int = 0,
    public: bool = False,
    mcp_expose: bool = False,
    mcp_scope: str | None = None,
) -> Callable[..., Any]:
    """Drop-in replacement for ``hof.function`` that tolerates our
    MCP-exposure kwargs.
    """

    def _attach(target: Callable[..., Any]) -> Callable[..., Any]:
        wrapped = _hof_function(
            name=name,
            description=description,
            tool_summary=tool_summary,
            when_to_use=when_to_use,
            when_not_to_use=when_not_to_use,
            related_tools=related_tools,
            tags=tags,
            timeout=timeout,
            retries=retries,
            public=public,
        )(target)
        try:
            wrapped.mcp_expose = mcp_expose  # type: ignore[attr-defined]
            wrapped.mcp_scope = mcp_scope  # type: ignore[attr-defined]
        except (AttributeError, TypeError):
            # Some wrapped objects might be non-mutable; fine — the
            # MCP bridge falls back to defaults via ``getattr``.
            pass
        return wrapped

    if fn is not None:
        return _attach(fn)
    return _attach
