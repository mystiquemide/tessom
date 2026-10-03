import { describe, expect, it } from "vitest";

import { CONSIGNMENT_RATE, computeOffers, type ProductTemplate, type Remnant } from "../../lib/offers";

const remnant = (overrides: Partial<Remnant> = {}): Remnant => ({
  widthCm: 100,
  heightCm: 100,
  fabric: { name: "Test cloth", valuePerM: 100 },
  directional: false,
  owner: { shareBps: 2_000 },
  ...overrides,
});

const template = (overrides: Partial<ProductTemplate> = {}): ProductTemplate => ({
  id: "cushion",
  name: "Cushion",
  pieces: [{ label: "front", wCm: 40, hCm: 40 }],
  seamCm: 0,
  labourMin: 10,
  fillCost: 5,
  ...overrides,
});

describe("computeOffers", () => {
  it("fits pieces, expands seam allowance on every side, and expands quantities", () => {
    const [offer] = computeOffers(
      remnant(),
      [
        template({
          pieces: [{ label: "front", wCm: 20, hCm: 30, qty: 2 }],
          seamCm: 2,
        }),
      ],
      { labourRate: 0, marginMultiplier: 1 },
    );

    expect(offer.placement).toHaveLength(2);
    expect(offer.placement[0]).toMatchObject({ w: 24, h: 34, rotated: false });
    expect(offer.placement[1]).toMatchObject({ w: 24, h: 34, rotated: false });
    expect(offer.usedArea).toBe(24 * 34 * 2);
  });

  it("places the largest pieces first without collisions or bounds violations", () => {
    const [offer] = computeOffers(
      remnant({ widthCm: 100, heightCm: 40 }),
      [
        template({
          pieces: [
            { label: "small", wCm: 30, hCm: 30 },
            { label: "large", wCm: 70, hCm: 20 },
          ],
        }),
      ],
      { marginMultiplier: 1 },
    );

    expect(offer.placement[0]).toMatchObject({ w: 70, h: 20, x: 0, y: 0 });
    expect(offer.placement[1]).toMatchObject({ w: 30, h: 30, x: 70, y: 0 });
    expect(offer.placement[0].x + offer.placement[0].w).toBeLessThanOrEqual(100);
    expect(offer.placement[1].x + offer.placement[1].w).toBeLessThanOrEqual(100);
  });

  it("allows rotation on non-directional remnants and rejects it on directional remnants", () => {
    const piece = template({ pieces: [{ label: "panel", wCm: 80, hCm: 100 }] });
    const rotated = computeOffers(remnant({ widthCm: 100, heightCm: 80 }), [piece], {
      labourRate: 0,
      marginMultiplier: 1,
    });
    expect(rotated).toHaveLength(1);
    expect(rotated[0].placement[0]).toMatchObject({ w: 100, h: 80, rotated: true });

    const directional = computeOffers(remnant({ widthCm: 100, heightCm: 80, directional: true }), [piece], {
      labourRate: 0,
      marginMultiplier: 1,
    });
    expect(directional).toHaveLength(0);
  });

  it("centres repeat-aware pieces on repeat multiples", () => {
    const [offer] = computeOffers(
      remnant({ repeat: { hCm: 20, vCm: 15 } }),
      [template({ pieces: [{ label: "pattern", wCm: 30, hCm: 30, centerPattern: true }] })],
      { labourRate: 0, marginMultiplier: 1 },
    );

    expect(offer.placement[0].x % 20).toBe(0);
    expect(offer.placement[0].y % 15).toBe(0);
  });

  it("rejects a centred piece when no repeat-aligned position remains", () => {
    const offers = computeOffers(
      remnant({
        widthCm: 15,
        heightCm: 20,
        repeat: { hCm: 20, vCm: 10 },
        allocations: [{ x: 0, y: 0, w: 5, h: 20 }],
      }),
      [template({ pieces: [{ label: "pattern", wCm: 10, hCm: 10, centerPattern: true }] })],
      { marginMultiplier: 1 },
    );

    expect(offers).toHaveLength(0);
  });

  it("subtracts defects and existing allocations before placement", () => {
    const blocked = template({ pieces: [{ label: "panel", wCm: 60, hCm: 60 }] });
    const defected = computeOffers(
      remnant({ defects: [{ x: 0, y: 0, w: 60, h: 60 }] }),
      [blocked],
      { labourRate: 0, marginMultiplier: 1 },
    );
    expect(defected).toHaveLength(0);

    const allocated = computeOffers(
      remnant({ allocations: [{ x: 0, y: 0, w: 50, h: 100 }] }),
      [template({ pieces: [{ label: "panel", wCm: 100, hCm: 100 }] })],
      { labourRate: 0, marginMultiplier: 1 },
    );
    expect(allocated).toHaveLength(0);
  });

  it("keeps feasible pieces clear of a partial defect and allocation", () => {
    const [offer] = computeOffers(
      remnant({
        widthCm: 100,
        heightCm: 100,
        defects: [{ x: 0, y: 0, w: 25, h: 100 }],
        allocations: [{ x: 75, y: 0, w: 25, h: 100 }],
      }),
      [template({ pieces: [{ label: "panel", wCm: 50, hCm: 100 }] })],
      { marginMultiplier: 1 },
    );

    expect(offer.placement[0]).toMatchObject({ x: 25, y: 0, w: 50, h: 100, rotated: false });
  });

  it("keeps maximal free strips around a central defect", () => {
    const [offer] = computeOffers(
      remnant({
        widthCm: 100,
        heightCm: 100,
        defects: [{ x: 40, y: 40, w: 20, h: 20 }],
      }),
      [template({ pieces: [{ label: "top", wCm: 90, hCm: 30 }] })],
      { marginMultiplier: 1 },
    );

    expect(offer.placement[0]).toMatchObject({ x: 0, y: 0, w: 90, h: 30 });
  });

  it("returns stable placements and offer ordering", () => {
    const templates = [
      template({ id: "z-template", name: "Z", pieces: [{ label: "z", wCm: 20, hCm: 30 }] }),
      template({ id: "a-template", name: "A", pieces: [{ label: "a", wCm: 30, hCm: 20 }] }),
    ];
    const first = computeOffers(remnant(), templates, { labourRate: 1.25, marginMultiplier: 1.4 });
    const second = computeOffers(remnant(), templates, { labourRate: 1.25, marginMultiplier: 1.4 });

    expect(second).toEqual(first);
    expect(first.map((offer) => offer.templateId)).toEqual(["a-template", "z-template"]);
  });

  it("recomputes identically when obstacle arrays are reordered", () => {
    const base = remnant({
      defects: [{ x: 10, y: 10, w: 20, h: 20 }, { x: 70, y: 0, w: 15, h: 100 }],
      allocations: [{ x: 40, y: 60, w: 20, h: 20 }],
    });
    const reordered = {
      ...base,
      defects: [...(base.defects ?? [])].reverse(),
      allocations: [...(base.allocations ?? [])].reverse(),
    };
    const templates = [
      template({ id: "z", pieces: [{ label: "a", wCm: 20, hCm: 20 }] }),
      template({ id: "a", pieces: [{ label: "b", wCm: 10, hCm: 30 }] }),
    ];

    expect(computeOffers(reordered, templates, { marginMultiplier: 1 })).toEqual(
      computeOffers(base, templates, { marginMultiplier: 1 }),
    );
  });

  it("prices area, labour, fill, margin, and the configurable owner margin slice", () => {
    const [offer] = computeOffers(
      remnant({ widthCm: 100, owner: { shareBps: 2_000 } }),
      [template({ pieces: [{ label: "front", wCm: 50, hCm: 50 }], labourMin: 10, fillCost: 5 })],
      { labourRate: 2, marginMultiplier: 1.5, ownerMarginSliceBps: 1_000 },
    );

    const fabric = (50 * 50 * 100) / (100 * 100) * CONSIGNMENT_RATE;
    const base = fabric + 20 + 5;
    expect(offer.price).toBe(Math.round(base * 1.5 * 100) / 100);
    expect(offer.ownerShare).toBe(Math.round((fabric * 0.2 + base * 0.5 * 0.1) * 100) / 100);
  });

  it("drops offers below the configured margin floor", () => {
    const offers = computeOffers(remnant(), [template()], {
      labourRate: 1,
      marginMultiplier: 1.1,
      marginFloor: 100,
    });
    expect(offers).toHaveLength(0);
  });

  it("rounds price and owner share at the configured currency precision", () => {
    const [offer] = computeOffers(
      remnant({ owner: { shareBps: 2_000 } }),
      [template({ pieces: [{ label: "front", wCm: 10, hCm: 10 }], labourMin: 1, fillCost: 0 })],
      {
        labourRate: 1.234,
        marginMultiplier: 1.333,
        ownerMarginSliceBps: 2_000,
        currencyDecimals: 0,
      },
    );

    expect(Number.isInteger(offer.price)).toBe(true);
    expect(Number.isInteger(offer.ownerShare)).toBe(true);

    const [halfCent] = computeOffers(
      remnant({ fabric: { valuePerM: 0 } }),
      [template({ pieces: [{ label: "front", wCm: 10, hCm: 10 }], labourMin: 0, fillCost: 10.075 })],
      { marginMultiplier: 1 },
    );
    expect(halfCent.price).toBe(10.08);
  });
});
