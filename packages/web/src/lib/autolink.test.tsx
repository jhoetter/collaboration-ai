import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";

import { findBareLinks, remarkAutolinkBareDomains } from "./autolink.ts";

function render(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkAutolinkBareDomains]}>{markdown}</ReactMarkdown>
  );
}

describe("findBareLinks", () => {
  it("matches a plain ccTLD domain", () => {
    const m = findBareLinks("check out hpi.de today");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({
      host: "hpi.de",
      url: "https://hpi.de",
      text: "hpi.de",
    });
  });

  it("matches a domain with a path", () => {
    const m = findBareLinks("see example.com/about for info");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({
      url: "https://example.com/about",
      text: "example.com/about",
    });
  });

  it("trims trailing sentence punctuation", () => {
    const m = findBareLinks("go to example.com.");
    expect(m).toHaveLength(1);
    expect(m[0].text).toBe("example.com");
  });

  it("ignores emails", () => {
    expect(findBareLinks("ping me at alex@hpi.de please")).toEqual([]);
  });

  it("ignores fully qualified URLs (handled by remark-gfm)", () => {
    expect(findBareLinks("see https://hpi.de today")).toEqual([]);
  });

  it("ignores file extensions like README.md / index.html / script.py", () => {
    expect(findBareLinks("see README.html and index.html")).toEqual([]);
    expect(findBareLinks("run script.py first")).toEqual([]);
    expect(findBareLinks("open package.json")).toEqual([]);
  });

  it("ignores version numbers and IPs", () => {
    expect(findBareLinks("v1.2.3 and 192.168.1.1")).toEqual([]);
  });

  it("matches multiple domains in one string", () => {
    const m = findBareLinks("hpi.de and example.org are both up");
    expect(m.map((x) => x.host)).toEqual(["hpi.de", "example.org"]);
  });

  it("preserves a long subdomain chain", () => {
    const m = findBareLinks("see foo.bar.example.com now");
    expect(m).toHaveLength(1);
    expect(m[0].host).toBe("foo.bar.example.com");
  });
});

describe("remarkAutolinkBareDomains via react-markdown", () => {
  it("wraps bare ccTLD domains in <a>", () => {
    const html = render("check out hpi.de today");
    expect(html).toContain('<a href="https://hpi.de"');
    expect(html).toContain(">hpi.de</a>");
  });

  it("wraps domain + path in <a> with the bare text as label", () => {
    const html = render("docs at example.com/about please");
    expect(html).toContain('<a href="https://example.com/about"');
    expect(html).toContain(">example.com/about</a>");
  });

  it("does not double-link existing markdown links", () => {
    const html = render("see [the docs](https://hpi.de) here");
    // Exactly one anchor tag.
    expect(html.match(/<a /g)?.length).toBe(1);
    expect(html).toContain(">the docs</a>");
  });

  it("does not link inside inline code spans", () => {
    const html = render("config in `cat hpi.de.txt` works");
    expect(html).not.toContain("<a ");
  });

  it("does not link inside fenced code blocks", () => {
    const html = render("```\nvisit hpi.de\n```");
    expect(html).not.toContain("<a ");
  });

  it("leaves emails alone (no bare-domain anchor on the host)", () => {
    // `remark-gfm` correctly turns the email into a `mailto:` link.
    // Our plugin must not also wrap the trailing `hpi.de` as a web link.
    const html = render("mail alex@hpi.de");
    expect(html).toContain('href="mailto:alex@hpi.de"');
    expect(html).not.toContain('href="https://hpi.de"');
  });
});
