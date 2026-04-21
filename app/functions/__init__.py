"""Re-export every @function for hof-engine's filesystem-based discovery.

Each domain owns its functions under ``app/domain/<entity>/functions.py``;
the imports here trigger registration without polluting the namespace.
"""

from domain.agents import functions as _agents  # noqa: F401
from domain.attachments import functions as _attachments  # noqa: F401
from domain.channels import functions as _channels  # noqa: F401
from domain.events import functions as _events  # noqa: F401
from domain.messages import functions as _messages  # noqa: F401
from domain.messages import functions_phase3 as _messages_phase3  # noqa: F401
from domain.workspaces import functions as _workspaces  # noqa: F401
