# Plugin system

A plugin extends `collaboration-ai` without forking. Two extension
points:

## 1. Custom commands

Drop a Python module under `app/plugins/<name>/handlers.py` exposing
`register(bus: CommandBus) -> None`. The startup hook discovers and
registers it. Plugins follow the same handler signature as built-ins
and run inside the same authorisation pipeline.

```python
def handle_jira_link(cmd: Command, state: ProjectedState) -> list[EventEnvelope]:
    ...
def register(bus: CommandBus) -> None:
    bus.register("jira:link-issue", handle_jira_link, authoriser=...)
```

## 2. Webhooks (outbound)

Plugins can subscribe to event streams via the projection bus:

```python
@subscribe("message.send", filter_channels=["#deploys"])
def notify_pagerduty(event: Event) -> None:
    ...
```

The subscription runs inside a Celery worker so a slow webhook never
blocks the command bus.

## What plugins can NOT do

- Bypass the command bus (no direct DB writes).
- Mutate the events table directly (audit integrity).
- Inject UI surfaces in the web app (the official surface is the embed
  package — `@collabai/react-embeds`).

These restrictions match `office-ai`'s plugin posture and keep the
event log canonical.
