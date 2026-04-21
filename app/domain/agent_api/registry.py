"""Reflective view over the hof-engine `@function` registry.

Every `@function` decorator records `(name, callable, mcp_expose,
mcp_scope)` plus the parameter signature. We translate that into MCP
tool descriptors at startup.

Pure-Python interface so the MCP server + the audit tests + the
CLI's local reflection all consume the same shape.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Any, Callable

# We deliberately don't import `hof` at module import time so the unit
# tests can register a fake registry instead.

_REGISTRY: dict[str, "FunctionEntry"] = {}


@dataclass(slots=True)
class FunctionEntry:
    name: str
    callable: Callable[..., Any]
    mcp_expose: bool
    mcp_scope: str | None
    docstring: str
    input_schema: dict[str, Any]


def _python_type_to_json_schema(t: Any) -> dict[str, Any]:
    if t is str:
        return {"type": "string"}
    if t is int:
        return {"type": "integer"}
    if t is float:
        return {"type": "number"}
    if t is bool:
        return {"type": "boolean"}
    origin = getattr(t, "__origin__", None)
    if origin is list:
        args = getattr(t, "__args__", ())
        item_schema = _python_type_to_json_schema(args[0]) if args else {"type": "string"}
        return {"type": "array", "items": item_schema}
    if origin is dict:
        return {"type": "object", "additionalProperties": True}
    return {"type": "string"}


def _signature_to_schema(callable_: Callable[..., Any]) -> dict[str, Any]:
    import typing

    sig = inspect.signature(callable_)
    try:
        hints = typing.get_type_hints(callable_)
    except Exception:
        hints = {}
    properties: dict[str, Any] = {}
    required: list[str] = []
    for name, param in sig.parameters.items():
        if name == "session":  # SQLAlchemy session is injected, not from the agent.
            continue
        annotation = hints.get(name, param.annotation)
        if annotation is inspect.Parameter.empty:
            properties[name] = {"type": "string"}
        else:
            properties[name] = _python_type_to_json_schema(annotation)
        if param.default is inspect.Parameter.empty and param.kind in (
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            inspect.Parameter.KEYWORD_ONLY,
        ):
            required.append(name)
    schema: dict[str, Any] = {
        "type": "object",
        "properties": properties,
    }
    if required:
        schema["required"] = required
    return schema


def register(name: str, fn: Callable[..., Any], *, mcp_expose: bool, mcp_scope: str | None) -> FunctionEntry:
    entry = FunctionEntry(
        name=name,
        callable=fn,
        mcp_expose=mcp_expose,
        mcp_scope=mcp_scope,
        docstring=inspect.getdoc(fn) or "",
        input_schema=_signature_to_schema(fn),
    )
    _REGISTRY[name] = entry
    return entry


def get(name: str) -> FunctionEntry | None:
    return _REGISTRY.get(name)


def all_entries() -> list[FunctionEntry]:
    return list(_REGISTRY.values())


def mcp_entries() -> list[FunctionEntry]:
    return [e for e in _REGISTRY.values() if e.mcp_expose]


def reset() -> None:
    """For tests."""
    _REGISTRY.clear()


def import_from_hof_registry() -> None:
    """At runtime, copy the hof-engine `@function` registry into ours.

    The hof-engine API is a thin descriptor (name, callable, kwargs);
    we read it lazily so unit tests can stub the registry.
    """
    try:
        import hof  # type: ignore
    except ImportError:
        return
    fns = getattr(hof, "functions", None) or getattr(hof, "_functions", None)
    if fns is None:
        return
    for name, descriptor in fns.items():
        register(
            name,
            descriptor.callable,
            mcp_expose=getattr(descriptor, "mcp_expose", False),
            mcp_scope=getattr(descriptor, "mcp_scope", None),
        )
