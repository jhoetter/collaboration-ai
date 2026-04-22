"""Link unfurl `@function` endpoint.

Fetches a remote URL with a 5s timeout, parses out the OpenGraph /
TwitterCard / favicon metadata, and returns a small dict suitable for
storing on a message as `attachments[].kind="link_preview"`.

The fetched metadata is also persisted via a `link.unfurl` event so the
projector can hand it back to other clients (and to the same user across
devices) without re-fetching. A simple in-process LRU keeps recent URLs
hot for ~1 hour to absorb composer-time and chat-render-time bursts.
"""

from __future__ import annotations

import re
import time
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from ..shared.command_bus import Command
from ..shared.decorators import function
from ..shared.runtime import get_command_bus, get_projected_state


_USER_AGENT = "collaboration-ai/0.1 (+https://github.com/code-kern-ai/collaboration-ai)"
_TIMEOUT_SECS = 5
_MAX_BYTES = 512_000
_CACHE_TTL_SECS = 60 * 60  # 1 hour
_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


class _OgParser(HTMLParser):
    """Minimal OpenGraph/Twitter card extractor.

    We deliberately avoid bringing in BeautifulSoup or lxml: the parser
    body is small, well-bounded, and we never hand the raw HTML back to
    callers. Anything fancy (script execution, JSON-LD, …) is out of
    scope.
    """

    def __init__(self) -> None:
        super().__init__()
        self.title: str | None = None
        self.description: str | None = None
        self.image: str | None = None
        self.site_name: str | None = None
        self.icon: str | None = None
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title" and self.title is None:
            self._in_title = True
            return
        if tag != "meta" and tag != "link":
            return
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            key = (attr_map.get("property") or attr_map.get("name") or "").lower()
            content = attr_map.get("content") or ""
            if not content:
                return
            if key in {"og:title", "twitter:title"} and not self.title:
                self.title = content
            elif key in {"og:description", "twitter:description", "description"} and not self.description:
                self.description = content
            elif key in {"og:image", "twitter:image", "twitter:image:src"} and not self.image:
                self.image = content
            elif key in {"og:site_name", "application-name"} and not self.site_name:
                self.site_name = content
        elif tag == "link":
            rel = (attr_map.get("rel") or "").lower()
            href = attr_map.get("href") or ""
            if "icon" in rel and not self.icon and href:
                self.icon = href

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title and self.title is None:
            stripped = data.strip()
            if stripped:
                self.title = stripped


def _from_cache(url: str) -> dict[str, Any] | None:
    hit = _CACHE.get(url)
    if hit is None:
        return None
    when, value = hit
    if time.time() - when > _CACHE_TTL_SECS:
        _CACHE.pop(url, None)
        return None
    return value


def _fetch(url: str) -> dict[str, Any] | None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    req = Request(url, headers={"User-Agent": _USER_AGENT, "Accept": "text/html,*/*;q=0.8"})
    try:
        with urlopen(req, timeout=_TIMEOUT_SECS) as resp:  # noqa: S310 — explicit URL whitelist above
            ctype = resp.headers.get("Content-Type", "")
            if "text/html" not in ctype.lower() and "application/xhtml" not in ctype.lower():
                return None
            raw = resp.read(_MAX_BYTES)
    except Exception:
        return None

    encoding = "utf-8"
    match = re.search(rb"charset=([\w-]+)", raw[:4096], re.IGNORECASE)
    if match:
        encoding = match.group(1).decode("ascii", errors="ignore") or "utf-8"
    try:
        text = raw.decode(encoding, errors="replace")
    except LookupError:
        text = raw.decode("utf-8", errors="replace")

    parser = _OgParser()
    try:
        parser.feed(text)
    except Exception:
        pass

    image_url = parser.image or parser.icon
    if image_url:
        image_url = urljoin(url, image_url)

    return {
        "url": url,
        "title": (parser.title or "").strip()[:240] or None,
        "description": (parser.description or "").strip()[:500] or None,
        "image_url": image_url,
        "site_name": (parser.site_name or parsed.netloc or "").strip()[:120] or None,
    }


@function(name="link:unfurl", mcp_expose=True, mcp_scope="read:links")
def unfurl(
    workspace_id: str,
    url: str,
    *,
    target_event_id: str | None = None,
    actor_id: str,
) -> dict[str, Any]:
    """Resolve OpenGraph metadata for ``url`` and persist it as an event."""
    state = get_projected_state()
    cached = state.link_unfurls.get(url) or _from_cache(url)
    if cached is None:
        result = _fetch(url)
        if result is None:
            return {"url": url, "title": None, "description": None, "image_url": None, "site_name": None}
        _CACHE[url] = (time.time(), result)
        cached = result

    payload: dict[str, Any] = {**cached, "url": url}
    if target_event_id is not None:
        payload["target_event_id"] = target_event_id

    bus = get_command_bus()
    bus.dispatch(
        Command(
            type="link:unfurl",
            payload=payload,
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
        )
    )
    return payload
