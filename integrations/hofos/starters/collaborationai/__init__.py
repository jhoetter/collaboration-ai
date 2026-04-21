"""hof-os adapter for the collaboration-ai sidecar.

Drop-in copy for `starters/hofos/domain/collaborationai/` in the hof-os
monorepo. Keeps the same shape as the existing `officeai/` starter:
`client.py` for a thin httpx wrapper, `agent_hooks.py` for the
allowlist + prompt hints, `functions.py` for the public `@function`
shells, and `workflow_hooks.py` for ergonomic helpers used inside
hof-engine flows.
"""
