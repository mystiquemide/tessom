import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BuiltOn } from "../../components/built-on";
import { ClosingCta } from "../../components/closing-cta";

describe("BuiltOn", () => {
  it("names Sanity with its real logo file and nothing else", () => {
    const html = renderToStaticMarkup(createElement(BuiltOn));
    expect(html).toContain("Sanity");
    expect(html).toContain("sanity.svg");
    for (const other of ["Next.js", "Unsplash", "Vercel"]) expect(html).not.toContain(other);
  });
});

describe("ClosingCta", () => {
  it("has one call to action that goes to the shop", () => {
    const html = renderToStaticMarkup(createElement(ClosingCta));
    expect(html).toContain('href="/#shop"');
    expect(html.match(/<a /g)).toHaveLength(1);
  });
});
