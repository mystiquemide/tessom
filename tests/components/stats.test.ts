import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Stats } from "../../components/stats";
import { shopStats, type ShopRemnant } from "../../lib/shop";

const remnant = (id: string, w: number, h: number, offers: number, status = "listed"): ShopRemnant => ({
  id, title: id, fabricName: id, maker: "", status, widthCm: w, heightCm: h, directional: false, repeat: null, photoUrl: null, defects: [], allocations: [],
  offers: Array.from({ length: offers }, (_, i) => ({ id: `${id}-${i}`, name: "x", kind: "cushion", imageUrl: null, fingerprint: "f", price: 10, ownerShare: 1, pieces: [] })),
});

describe("shopStats", () => {
  it("counts only remnants that can be ordered", () => {
    const stats = shopStats([remnant("a", 100, 100, 2), remnant("b", 200, 100, 3), remnant("c", 100, 100, 4, "allocated"), remnant("d", 100, 100, 0)]);
    expect(stats).toEqual({ pieces: 2, offers: 5, areaM2: 3 });
  });
});

describe("Stats", () => {
  it("renders each non-zero figure, including small areas", () => {
    const html = renderToStaticMarkup(createElement(Stats, { stats: { pieces: 1, offers: 2, areaM2: 0.5 } }));
    expect(html).toContain("offcut on the table");
    expect(html).toContain("cuts to choose from");
    expect(html).toContain("0.5 m²");
  });

  it("renders nothing when the table is empty", () => {
    expect(renderToStaticMarkup(createElement(Stats, { stats: { pieces: 0, offers: 0, areaM2: 0 } }))).toBe("");
  });
});
