import { describe, expect, it } from "vitest";

import { describeOfferPieces, planningFacts, type ShopOffer, type ShopRemnant } from "../lib/shop";

const piece = (label: string, wCm: number, hCm: number) => ({ x: 0, y: 0, w: wCm + 2, h: hCm + 2, rotated: false, label, wCm, hCm });
const offer: ShopOffer = { id: "t", name: "Cushion", kind: "cushion", imageUrl: null, fingerprint: "f", price: 50, ownerShare: 5, pieces: [piece("Front", 45, 45), piece("Back", 45, 45), piece("Back", 45, 45)] };
const base: ShopRemnant = {
  id: "r", title: "T", fabricName: "Teal Trellis", maker: "Mill", status: "listed", widthCm: 160, heightCm: 100, directional: false, repeat: null,
  photoUrl: null, defects: [], allocations: [], offers: [offer],
};

describe("describeOfferPieces", () => {
  it("groups identical pieces", () => {
    expect(describeOfferPieces(offer)).toBe("Front 45×45 · 2 × Back 45×45");
    expect(describeOfferPieces(offer, ", ")).toBe("Front 45×45, 2 × Back 45×45");
  });
});

describe("planningFacts", () => {
  it("states only what the remnant data says", () => {
    expect(planningFacts(base)).toEqual([
      "160 × 100 cm of Teal Trellis from Mill.",
      "This fabric has no direction, so pieces can be turned to fit.",
    ]);
  });

  it("covers direction, repeat, flaws and sold areas", () => {
    const facts = planningFacts({
      ...base, directional: true, repeat: { vCm: 32, hCm: 16 },
      defects: [{ x: 0, y: 0, w: 5, h: 5 }], allocations: [{ x: 0, y: 0, w: 5, h: 5 }, { x: 9, y: 9, w: 5, h: 5 }],
    });
    expect(facts[1]).toContain("every piece is cut the same way up");
    expect(facts).toContain("The pattern repeats every 32 cm down and 16 cm across. Pieces are placed to line up with it.");
    expect(facts).toContain("One flaw is hatched on the plan. No piece is cut over a flaw.");
    expect(facts).toContain("2 areas are already ordered and shown darkened.");
  });

  it("handles a repeat in one direction only", () => {
    expect(planningFacts({ ...base, repeat: { hCm: 20 } })).toContain("The pattern repeats every 20 cm across. Pieces are placed to line up with it.");
  });
});
