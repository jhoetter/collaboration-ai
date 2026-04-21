"""Allowlist + prompt hints for the main hof-os Assistent.

Mirrors `starters/hofos/domain/officeai/agent_hooks.py`. The data-app
Assistent imports `ALLOWED_TOOLS` and `PROMPT_HINTS` and merges them
into its system prompt + tool registry, so a single edit here
propagates across all tenants.
"""

from __future__ import annotations

ALLOWED_TOOLS: tuple[str, ...] = (
    "collab:send-message",
    "collab:open-thread",
    "collab:request-agent-approval",
)

PROMPT_HINTS: dict[str, str] = {
    "collab:send-message": (
        "Use this to drop status messages into the user's team chat. "
        "Prefer the channel the user already mentioned; don't invent new ones. "
        "Always include a one-line summary in `content` — the chat is the "
        "primary surface, the assistant transcript is secondary."
    ),
    "collab:open-thread": (
        "Use this when the user asks 'where did we discuss …'. Returns a deep "
        "link the user can click; do not paraphrase the link."
    ),
    "collab:request-agent-approval": (
        "Use for actions that mutate org-wide state (renames, deletions, "
        "permission changes). Stage them via this tool instead of executing "
        "directly so the workspace admin can approve in the agent inbox."
    ),
}
