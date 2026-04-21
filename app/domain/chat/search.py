"""In-memory full-text search over the projected message corpus.

The production backend swaps this for a Postgres `tsvector` index that
materialises per-message tokens at projection time. The pure-Python
implementation here is what the unit tests + dev server use, and is
also a useful reference for the SQL semantics:

* NFKC normalisation so half-width katakana, full-width ASCII, etc.
  collapse onto canonical forms.
* Lowercase via `str.lower()` (covers the Latin script; for CJK this
  is a no-op).
* Tokenise on Unicode word boundaries via :mod:`re` with
  ``re.UNICODE``; for CJK we additionally split on each character so a
  query of ``"猫"`` matches inside ``"うちの猫が好きです"``.
* Match a message if **every** query token appears either as a token
  or a substring of any token.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable

from ..events.projector import ProjectedState

_WORD_RE = re.compile(r"[\w]+", re.UNICODE)


def _is_cjk(ch: str) -> bool:
    cp = ord(ch)
    # CJK Unified Ideographs + Hiragana + Katakana + Hangul
    return (
        0x3040 <= cp <= 0x309F
        or 0x30A0 <= cp <= 0x30FF
        or 0x4E00 <= cp <= 0x9FFF
        or 0xAC00 <= cp <= 0xD7AF
    )


def normalize(text: str) -> str:
    return unicodedata.normalize("NFKC", text).lower()


def tokenize(text: str) -> list[str]:
    norm = normalize(text)
    tokens: list[str] = []
    for word in _WORD_RE.findall(norm):
        tokens.append(word)
        # Per-char split for CJK strings so "猫" matches inside "うちの猫".
        if any(_is_cjk(ch) for ch in word):
            tokens.extend(ch for ch in word if _is_cjk(ch))
    return tokens


@dataclass(slots=True, frozen=True)
class SearchHit:
    message_id: str
    workspace_id: str
    channel_id: str
    sender_id: str
    content: str
    sequence: int


def _attachment_text(msg: dict) -> str:
    parts: list[str] = []
    for att in msg.get("attachments") or []:
        if isinstance(att, dict):
            name = att.get("name") or ""
            if name:
                parts.append(name)
    return " ".join(parts)


def search_messages(
    state: ProjectedState,
    *,
    workspace_id: str,
    query: str,
    channel_ids: Iterable[str] | None = None,
    sender_id: str | None = None,
    limit: int = 50,
) -> list[SearchHit]:
    q_tokens = tokenize(query)
    if not q_tokens:
        return []
    channel_filter = set(channel_ids) if channel_ids else None
    hits: list[SearchHit] = []
    for msg in state.messages.values():
        if msg["workspace_id"] != workspace_id:
            continue
        if msg.get("redacted"):
            continue
        if channel_filter is not None and msg["channel_id"] not in channel_filter:
            continue
        if sender_id is not None and msg["sender_id"] != sender_id:
            continue
        haystack_tokens = tokenize(msg.get("content", "") + " " + _attachment_text(msg))
        haystack_set = set(haystack_tokens)
        haystack_str = " ".join(haystack_tokens)
        if all(tok in haystack_set or tok in haystack_str for tok in q_tokens):
            hits.append(
                SearchHit(
                    message_id=msg["id"],
                    workspace_id=msg["workspace_id"],
                    channel_id=msg["channel_id"],
                    sender_id=msg["sender_id"],
                    content=msg.get("content", ""),
                    sequence=int(msg.get("sequence", 0)),
                )
            )
    hits.sort(key=lambda h: h.sequence, reverse=True)
    return hits[:limit]
