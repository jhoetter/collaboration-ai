"""Function registration shim package.

The actual domain re-exports live in ``register.py`` because hof-engine's
discovery scanner ignores any module whose filename starts with ``_``
(including ``__init__.py``). Keeping this file empty avoids accidental
duplicate registration.
"""
