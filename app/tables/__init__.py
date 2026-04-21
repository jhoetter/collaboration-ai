"""Table registration shim package.

The actual domain re-exports live in ``register.py`` so hof-engine's
discovery picks them up — its scanner skips any file whose name starts
with ``_``, ``__init__.py`` included.
"""
