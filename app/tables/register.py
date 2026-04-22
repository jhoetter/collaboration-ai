"""Single import target for hof-engine's filesystem-based discovery.

hof scans ``app/tables/`` for modules whose name does **not** start
with ``_``; ``__init__.py`` is skipped. Each domain owns its tables
under ``app/domain/<entity>/table.py``; this re-export keeps the
top-level ``tables/`` directory hof-engine expects.
"""

from domain.agents.table import Agent, Proposal
from domain.attachments.table import Attachment
from domain.channels.table import Channel, ChannelMember
from domain.events.table import EventRow, WorkspaceSequence
from domain.huddles.table import Huddle, HuddleParticipant
from domain.messages.table import Draft, Message, Pinned, ReadMarker, Reaction
from domain.notifications.table import Notification
from domain.users.table import User
from domain.workspaces.table import Workspace, WorkspaceMember

__all__ = [
    "Agent",
    "Attachment",
    "Channel",
    "ChannelMember",
    "Draft",
    "EventRow",
    "Huddle",
    "HuddleParticipant",
    "Message",
    "Notification",
    "Pinned",
    "Proposal",
    "ReadMarker",
    "Reaction",
    "User",
    "Workspace",
    "WorkspaceMember",
    "WorkspaceSequence",
]
