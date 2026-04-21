"""`hofos collab` CLI group.

Drop into `backend/app/cli/` in hof-os and register from
`backend/app/cli/__init__.py` (`app.add_typer(collabai_app, name="collab")`).
Mirrors the existing `hofos office` group's layout — Typer + Rich, no
extra deps.
"""

from __future__ import annotations

import json
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

collabai_app = typer.Typer(help="collaboration-ai sidecar controls")
bridges_app = typer.Typer(help="Read-only bridges from external chat systems")
agent_app = typer.Typer(help="Agent staging / approval")
collabai_app.add_typer(bridges_app, name="bridges")
collabai_app.add_typer(agent_app, name="agent")

console = Console()


def _read_lockfile() -> dict | None:
    candidates = [Path.cwd(), *Path.cwd().parents]
    for c in candidates:
        f = c / "infra" / "collabai.lock.json"
        if f.exists():
            return json.loads(f.read_text())
    return None


@collabai_app.command()
def status() -> None:
    """Show sidecar health + the version pinned in infra/collabai.lock.json."""
    lock = _read_lockfile()
    if not lock:
        console.print("[yellow]No infra/collabai.lock.json found.[/]")
        raise typer.Exit(code=1)
    table = Table(show_header=False)
    table.add_row("version", lock.get("version", "?"))
    table.add_row("app_image", lock.get("app_image", "?"))
    table.add_row("agent_version", lock.get("agent_version", "?"))
    table.add_row("react_embeds_version", lock.get("react_embeds_version", "?"))
    console.print(table)


@collabai_app.command()
def bump() -> None:
    """Fetch the latest collaboration-ai release and rewrite the lockfile."""
    from .._collabai_internal import bump_lockfile  # type: ignore[import-not-found]
    bump_lockfile()


@bridges_app.command("slack-import")
def slack_import(zip_path: Path, workspace: str = typer.Option(..., "--workspace", "-w")) -> None:
    """Import a Slack workspace export into archive channels."""
    from .._collabai_internal import call_function  # type: ignore[import-not-found]
    result = call_function(
        "bridges:slack-import",
        {"workspace_id": workspace, "export_path": str(zip_path)},
    )
    console.print(result)


@bridges_app.command("matrix-configure")
def matrix_configure(workspace: str = typer.Option(..., "--workspace", "-w")) -> None:
    """Interactively configure the Matrix poller for this workspace."""
    homeserver = typer.prompt("Matrix homeserver URL")
    access_token = typer.prompt("Access token", hide_input=True)
    from .._collabai_internal import call_function  # type: ignore[import-not-found]
    call_function(
        "bridges:matrix-configure",
        {
            "workspace_id": workspace,
            "homeserver": homeserver,
            "access_token": access_token,
        },
    )
    console.print("[green]Matrix poller configured.[/]")


@agent_app.command("stage")
def agent_stage(
    command_json: str = typer.Argument(..., help="JSON command payload"),
    workspace: str = typer.Option(..., "--workspace", "-w"),
    agent_id: str = typer.Option(..., "--agent-id"),
) -> None:
    """Stage an agent command for human approval."""
    payload = json.loads(command_json)
    from .._collabai_internal import call_function  # type: ignore[import-not-found]
    result = call_function(
        "agent:stage-command",
        {"workspace_id": workspace, "agent_id": agent_id, **payload},
    )
    console.print(result)


@agent_app.command("approve")
def agent_approve(proposal_id: str, workspace: str = typer.Option(..., "--workspace", "-w")) -> None:
    """Approve a pending agent proposal."""
    from .._collabai_internal import call_function  # type: ignore[import-not-found]
    call_function("agent:approve", {"workspace_id": workspace, "proposal_id": proposal_id})
    console.print(f"[green]Approved {proposal_id}[/]")
