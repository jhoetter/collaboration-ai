"""Server-side CommonMark + HTML sanitisation.

Pure Python so it can be unit-tested in isolation. The web client also
runs `dompurify` on the rendered HTML as defence-in-depth.
"""

from __future__ import annotations

ALLOWED_TAGS = {
    "p",
    "br",
    "strong",
    "em",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "a",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
}
ALLOWED_ATTRS = {
    "a": ["href", "title", "rel"],
    "code": ["class"],
    "pre": ["class"],
}


def render_markdown(content: str) -> str:
    """Render Markdown → sanitised HTML.

    The runtime imports `markdown_it` and `bleach`; we keep the import
    inside the function so the projection tests don't pull them in.
    """
    from markdown_it import MarkdownIt
    import bleach

    md = MarkdownIt("commonmark", {"html": False, "linkify": True, "typographer": True})
    raw_html = md.render(content)
    cleaned = bleach.clean(
        raw_html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRS,
        protocols=["http", "https", "mailto"],
        strip=True,
    )
    cleaned = bleach.linkify(
        cleaned,
        callbacks=[lambda attrs, new=False: {**attrs, (None, "rel"): "noopener noreferrer ugc"}],
    )
    return cleaned
