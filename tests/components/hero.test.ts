import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Hero } from "../../components/hero";
import type { ShopRemnant } from "../../lib/shop";

const remnant: ShopRemnant = {
  id: "r1",
  title: "Teal Trellis",
  fabricName: "Teal Trellis",
  maker: "Mill",
  status: "listed",
  widthCm: 160,
  heightCm: 100,
  directional: false,
  repeat: null,
  photoUrl: "https://example.test/t.jpg",
  defects: [],
  allocations: [],
  offers: [
    { id: "t1", name: "Pad", kind: "cushion", imageUrl: null, fingerprint: "f", price: 85.55, ownerShare: 6, pieces: [{ x: 0, y: 0, w: 47, h: 47, rotated: false, label: "Front", wCm: 45, hCm: 45 }] },
    { id: "t2", name: "Bag", kind: "tote", imageUrl: null, fingerprint: "f", price: 95, ownerShare: 7, pieces: [] },
  ],
};

describe("Hero", () => {
  it("shows the headline, the call to action and one card per remnant", () => {
    const html = renderToStaticMarkup(createElement(Hero, { remnants: [remnant] }));
    expect(html).toContain("Every offcut has a next piece.");
    expect(html).toContain('href="/shop"');
    expect(html).toContain("Teal Trellis");
    expect(html).toContain("from $85.55");
    expect(html).toContain("160 × 100 cm");
    expect(html).toContain("2 offers");
    expect(html).toContain("Consent granted");
  });

  it("shows no cards and no stamp when nothing is on the table", () => {
    const html = renderToStaticMarkup(createElement(Hero, { remnants: [] }));
    expect(html).toContain("Every offcut has a next piece.");
    expect(html).not.toContain("<article");
    expect(html).not.toContain("One of one");
  });
});
