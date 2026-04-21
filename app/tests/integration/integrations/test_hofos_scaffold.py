"""Sanity checks on integrations/hofos/ — keep the drop-in artefacts
discoverable so the release PR doesn't ship a half-empty starter.
"""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
HOFOS_DIR = REPO_ROOT / "integrations" / "hofos"


def test_required_files_exist() -> None:
    expected = [
        "Dockerfile.collabai-app",
        "Dockerfile.collabai-sandbox",
        "ensure-collabai-react-embeds.cjs",
        "starters/collaborationai/__init__.py",
        "starters/collaborationai/client.py",
        "starters/collaborationai/functions.py",
        "starters/collaborationai/agent_hooks.py",
        "starters/collaborationai/workflow_hooks.py",
        "cli/collabai.py",
        "ui/ChatSidebar.tsx",
        "README.md",
    ]
    missing = [p for p in expected if not (HOFOS_DIR / p).exists()]
    assert not missing, f"Missing integration files: {missing}"


def test_release_pr_script_writes_lockfile_with_three_pins() -> None:
    """The bump script must emit all three lockfile pins atomically.

    We check the heredoc body, not a real run, so we don't need git
    or network access in the test environment.
    """
    script = (REPO_ROOT / "infra" / "release" / "open-hofos-pr.sh").read_text()
    for key in ("app_image", "agent_tarball", "react_embeds_tarball"):
        assert key in script, f"open-hofos-pr.sh is missing pin: {key}"


def test_dockerfiles_pin_via_lockfile_inputs() -> None:
    sandbox = (HOFOS_DIR / "Dockerfile.collabai-sandbox").read_text()
    assert "ARG AGENT_TARBALL" in sandbox
    assert "/usr/local/bin/collab" in sandbox

    app = (HOFOS_DIR / "Dockerfile.collabai-app").read_text()
    assert "ghcr.io/jhoetter/collaboration-ai" in app


def test_postinstall_script_targets_correct_package() -> None:
    cjs = (HOFOS_DIR / "ensure-collabai-react-embeds.cjs").read_text()
    assert "@collabai/react-embeds" in cjs
    assert "infra/collabai.lock.json" in cjs


def test_release_workflow_emits_three_artefacts() -> None:
    workflow = json.loads(json.dumps((REPO_ROOT / ".github" / "workflows" / "release.yml").read_text()))
    for needle in ("collabai-app-", "collabai-agent-", "collabai-react-embeds-"):
        assert needle in workflow, f"release.yml missing artefact: {needle}"
