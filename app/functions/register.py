"""Single import target for hof-engine's filesystem-based discovery.

hof scans ``app/functions/`` and imports every module whose name does
**not** start with ``_``. ``__init__.py`` is therefore skipped, so the
re-export indirection has to live in a regular module file —
otherwise none of our domain ``@function`` decorators ever run and the
API ends up serving only the hof builtins.

Each domain owns its functions under ``app/domain/<entity>/functions.py``;
the imports here trigger registration without polluting the namespace.

In addition to function discovery, this module hooks the FastAPI app
construction in hof to mount the realtime ``/api/sync`` + ``/ws/events``
gateway. hof's ``create_app`` doesn't expose a public router-extension
hook, so we patch its internal ``_mount_user_pages`` (which runs after
every other router is registered) to attach our routes first.
"""

from domain.agents import functions as _agents  # noqa: F401
from domain.attachments import functions as _attachments  # noqa: F401
from domain.channels import functions as _channels  # noqa: F401
from domain.demo import functions as _demo  # noqa: F401
from domain.events import functions as _events  # noqa: F401
from domain.messages import functions as _messages  # noqa: F401
from domain.messages import functions_phase3 as _messages_phase3  # noqa: F401
from domain.users import functions as _users  # noqa: F401
from domain.workspaces import functions as _workspaces  # noqa: F401


def _install_sync_router_hook() -> None:
    """Wedge our realtime router onto hof's FastAPI app.

    hof's ``create_app`` does not expose a hook for user-defined
    routers, but it does call ``_mount_user_pages(app, …)`` as the very
    last step of app construction (after every built-in router is
    attached and before the SPA catch-all goes on). We wrap that call so
    we can ``app.include_router(sync_router)`` first — the SPA catch-all
    runs immediately after, which is fine because explicit routes take
    priority over the catch-all in FastAPI's matching order.
    """
    from hof.api import server as _hof_server

    if getattr(_hof_server, "_collabai_sync_mounted", False):
        return

    original_mount = _hof_server._mount_user_pages

    def patched_mount(app, project_root, config):  # type: ignore[no-untyped-def]
        from domain.shared.runtime import get_session_factory
        from domain.sync.bridge import get_fanout
        from domain.sync.ws_gateway import build_router

        router = build_router(fanout=get_fanout(), session_factory=get_session_factory())
        app.include_router(router, tags=["realtime-collab"])
        return original_mount(app, project_root, config)

    _hof_server._mount_user_pages = patched_mount
    _hof_server._collabai_sync_mounted = True


_install_sync_router_hook()
