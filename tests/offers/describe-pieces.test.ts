import { describe, expect, it } from "vitest";

import { computeOffers, describePieces, type ProductTemplate, type Remnant } from "../../lib/offers";

const template: ProductTemplate = {
  _id: "template-x",
  name: "Test pad",
  seamCm: 1.5,
  pieces: [
    { label: "Back", wCm: 30, hCm: 20 },
    { label: "Front", wCm: 50, hCm: 40, qty: 2 },
  ],
};

describe("describePieces", () => {
  it("lists pieces largest first with finished sizes and no seam allowance", () => {
    expect(describePieces(template)).toEqual([
      { label: "Front", wCm: 50, hCm: 40 },
      { label: "Front", wCm: 50, hCm: 40 },
      { label: "Back", wCm: 30, hCm: 20 },
    ]);
  });

  it("matches the placement order of a real offer", () => {
    const remnant: Remnant = { _id: "r", widthCm: 200, heightCm: 120, fabric: { valuePerM: 60 } };
    const [offer] = computeOffers(remnant, [template]);
    const labels = describePieces(template)!;
    expect(offer.placement).toHaveLength(labels.length);
    offer.placement.forEach((placed, index) => {
      const sizes = [labels[index].wCm + 3, labels[index].hCm + 3].sort((a, b) => a - b);
      expect([placed.w, placed.h].sort((a, b) => a - b)).toEqual(sizes);
    });
  });

  it("returns undefined for a template with no usable pieces", () => {
    expect(describePieces({ name: "Empty", pieces: [] })).toBeUndefined();
  });
});
