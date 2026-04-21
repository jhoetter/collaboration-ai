"""Re-export every Table for hof-engine's filesystem-based discovery.

Each domain owns its tables under ``app/domain/<entity>/table.py``;
this package keeps the top-level ``tables/`` directory hof-engine
expects, just as a thin re-export.
"""

from domain.agents.table import Agent, Proposal
from domain.attachments.table import Attachment
from domain.channels.table import Channel, ChannelMember
from domain.events.table import EventRow, WorkspaceSequence
from domain.messages.table import Draft, Message, Pinned, ReadMarker, Reaction
from domain.workspaces.table import Workspace, WorkspaceMember

__all__ = [
    "Agent",
    "Attachment",
    "Channel",
    "ChannelMember",
    "Draft",
    "EventRow",
    "Message",
    "Pinned",
    "Proposal",
    "ReadMarker",
    "Reaction",
    "Workspace",
    "WorkspaceMember",
    "WorkspaceSequence",
]
