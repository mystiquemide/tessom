import { describe, expect, it } from "vitest";

import { buildShopRemnants, formatPrice, fromPrice, orderable } from "../lib/shop";

const templates = [
  { _id: "t-pad", name: "Pad", seamCm: 1, labourMin: 20, fillCost: 5, active: true, pieces: [{ label: "Top", wCm: 40, hCm: 40 }] },
  { _id: "t-bag", name: "Bag", seamCm: 1, labourMin: 20, fillCost: 5, active: true, pieces: [{ label: "Body", wCm: 90, hCm: 90 }] },
];

const base = { widthCm: 100, heightCm: 100, fabric: { name: "Test", maker: "Mill", valuePerM: 60 } };

describe("shop remnants", () => {
  it("builds labelled offers from the pricing engine", () => {
    const [remnant] = buildShopRemnants({ remnants: [{ ...base, _id: "r1", title: "Test", status: "listed" }], templates });
    expect(remnant.offers.map((offer) => offer.name)).toContain("Pad");
    const pad = remnant.offers.find((offer) => offer.id === "t-pad")!;
    expect(pad.pieces[0]).toMatchObject({ label: "Top", wCm: 40, hCm: 40 });
    expect(pad.price).toBeGreaterThan(0);
  });

  it("only offers what physically fits", () => {
    const [remnant] = buildShopRemnants({ remnants: [{ ...base, widthCm: 50, heightCm: 50, _id: "r2", title: "Small", status: "listed" }], templates });
    expect(remnant.offers.map((offer) => offer.id)).toEqual(["t-pad"]);
  });

  it("keeps listed remnants with offers, most offers first", () => {
    const remnants = buildShopRemnants({
      remnants: [
        { ...base, widthCm: 50, heightCm: 50, _id: "a", title: "A", status: "listed" },
        { ...base, _id: "b", title: "B", status: "listed" },
        { ...base, _id: "c", title: "C", status: "allocated" },
        { ...base, widthCm: 10, heightCm: 10, _id: "d", title: "D", status: "listed" },
      ],
      templates,
    });
    expect(orderable(remnants).map((remnant) => remnant.id)).toEqual(["b", "a"]);
  });

  it("formats prices and the lowest offer", () => {
    expect(formatPrice(95)).toBe("$95");
    expect(formatPrice(109.07)).toBe("$109.07");
    const [remnant] = buildShopRemnants({ remnants: [{ ...base, _id: "r1", title: "Test", status: "listed" }], templates });
    expect(fromPrice(remnant)).toBe(Math.min(...remnant.offers.map((offer) => offer.price)));
    expect(fromPrice({ ...remnant, offers: [] })).toBeNull();
  });
});
