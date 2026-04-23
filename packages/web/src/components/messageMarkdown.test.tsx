/**
 * Verify that the same `react-markdown` setup the chat uses actually
 * renders `[label](url)` and bare `https://...` URLs as anchor tags.
 * If this test starts failing, the chat will silently regress to plain
 * text for links.
 */
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";

function render(markdown: string): string {
  return renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>);
}

describe("react-markdown link rendering", () => {
  it("renders [label](url) as <a>", () => {
    const html = render("see [the docs](https://example.com)");
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain(">the docs</a>");
  });

  it("auto-links bare https URLs via remark-gfm", () => {
    const html = render("visit https://example.com today");
    expect(html).toContain('<a href="https://example.com"');
  });
});
