import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BuiltOn } from "../../components/built-on";
import { ClosingCta } from "../../components/closing-cta";

describe("BuiltOn", () => {
  it("names only what the product is built on, with real logo files", () => {
    const html = renderToStaticMarkup(createElement(BuiltOn));
    for (const name of ["Sanity", "Next.js", "Unsplash"]) expect(html).toContain(name);
    for (const file of ["sanity.svg", "nextdotjs.svg", "unsplash.svg"]) expect(html).toContain(file);
    expect(html).not.toContain("Vercel");
  });
});

describe("ClosingCta", () => {
  it("has one call to action that goes to the shop", () => {
    const html = renderToStaticMarkup(createElement(ClosingCta));
    expect(html).toContain('href="/#shop"');
    expect(html.match(/<a /g)).toHaveLength(1);
  });
});
