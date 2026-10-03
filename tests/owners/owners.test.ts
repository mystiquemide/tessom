import { describe, expect, it } from "vitest";

import { buildOwners, stageLabel, type RawOwners } from "../../lib/owners";

const data: RawOwners = {
  owners: [
    { _id: "o1", name: "Clara Morrow", kind: "client", shareBps: 2000 },
    { _id: "o2", name: "Northlight", kind: "designer", shareBps: 2200 },
    { _id: "o3", name: "Empty Studio" },
  ],
  remnants: [
    { _id: "r1", title: "Teal Trellis", status: "listed", widthCm: 160, heightCm: 100, ownerId: "o1" },
    { _id: "r2", title: "Rose Stripe", status: "consented", widthCm: 90, heightCm: 70, ownerId: "o1" },
    { _id: "r3", title: "Sage Crepe", status: "allocated", widthCm: 200, heightCm: 110, ownerId: "o2" },
    { _id: "r4", title: "Midnight Fern", status: "sold-out", widthCm: 140, heightCm: 90, ownerId: "o2" },
    { _id: "r5", title: "Ink Floral", status: "returned", widthCm: 140, heightCm: 90, ownerId: "o2" },
  ],
  orders: [
    { _id: "a", ownerShare: 5.32, remnantId: "r3", stage: "cut" },
    { _id: "b", ownerShare: 7.07, remnantId: "r4", stage: "sold-out" },
    { _id: "c", ownerShare: 1.1, remnantId: "r4", stage: "sold-out" },
  ],
};

describe("stageLabel", () => {
  it("speaks in the owner's words", () => {
    expect(stageLabel("intake", null, false)).toBe("Awaiting your consent");
    expect(stageLabel("consented", null, false)).toBe("Awaiting your consent");
    expect(stageLabel("listed", null, false)).toBe("Listed");
    expect(stageLabel("returned", null, false)).toBe("Consent declined");
    expect(stageLabel("allocated", "allocated", true)).toBe("Allocated");
    expect(stageLabel("allocated", "sewn", true)).toBe("Sewn");
    expect(stageLabel("sold-out", "sold-out", true)).toBe("Shipped");
    expect(stageLabel("sold-out", null, false)).toBe("Sold out");
  });
});

describe("buildOwners", () => {
  const owners = buildOwners(data);
  const by = (id: string) => owners.find((owner) => owner.id === id)!;

  it("gives each owner only their own pieces", () => {
    expect(by("o1").remnants.map((r) => r.title)).toEqual(["Teal Trellis", "Rose Stripe"]);
    expect(by("o2").remnants).toHaveLength(3);
    expect(by("o3").remnants).toEqual([]);
  });

  it("adds up accrued earnings per piece and per owner", () => {
    expect(by("o2").remnants.find((r) => r.title === "Sage Crepe")!.earned).toBe(5.32);
    expect(by("o2").remnants.find((r) => r.title === "Midnight Fern")!.earned).toBe(8.17);
    expect(by("o2").earned).toBe(13.49);
    expect(by("o1").earned).toBe(0);
  });

  it("flags only unconsented pieces as awaiting a decision", () => {
    expect(by("o1").remnants.map((r) => r.awaitingConsent)).toEqual([false, true]);
    expect(by("o2").remnants.every((r) => !r.awaitingConsent)).toBe(true);
  });

  it("shows share and kind, and copes with missing details", () => {
    expect(by("o1").sharePercent).toBe(20);
    expect(by("o2").kindLabel).toBe("Designer");
    expect(by("o3").sharePercent).toBeNull();
    expect(by("o3").kindLabel).toBe("Owner");
  });
});
