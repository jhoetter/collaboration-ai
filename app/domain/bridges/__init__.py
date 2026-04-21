"""Read-only bridges from external chat systems into archive channels.

Phase 6, opt-in per workspace. Slack supports a one-shot zip-export
import; Matrix supports an incremental client-server `/sync` poll.
Both are background flows that funnel through the same command bus
and audit plumbing as human messages.
"""
