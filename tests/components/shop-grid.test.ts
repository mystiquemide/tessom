import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ShopGrid } from "../../components/shop-grid";
import { availableKinds, filterByKind, isShopKind, shelfOrder, type ShopRemnant } from "../../lib/shop";

const offer = (id: string, kind: string, price: number) => ({ id, name: id, kind, imageUrl: null, fingerprint: "f", price, ownerShare: 1, pieces: [] });
const remnant = (id: string, status: string, offers: ReturnType<typeof offer>[]): ShopRemnant => ({
  id, title: `Fabric ${id}`, fabricName: id, maker: "", status, widthCm: 100, heightCm: 80, directional: false, repeat: null, photoUrl: null, defects: [], allocations: [], offers,
});

const a = remnant("a", "listed", [offer("pad", "cushion", 50), offer("bag", "tote", 80)]);
const b = remnant("b", "listed", [offer("bag2", "tote", 70)]);
const c = remnant("c", "allocated", [offer("pad2", "cushion", 40)]);
const d = remnant("d", "listed", []);
const e: ShopRemnant = { ...remnant("e", "allocated", []), allocations: [{ x: 0, y: 0, w: 50, h: 50 }] };
const all = [d, c, b, a];

describe("shop filters", () => {
  it("validates kinds", () => {
    expect(isShopKind("tote")).toBe(true);
    expect(isShopKind("toString")).toBe(false);
    expect(isShopKind(undefined)).toBe(false);
  });

  it("keeps only remnants and offers of the chosen kind", () => {
    const totes = filterByKind(all, "tote");
    expect(totes.map((r) => r.id)).toEqual(["b", "a"]);
    expect(totes.find((r) => r.id === "a")!.offers.map((o) => o.id)).toEqual(["bag"]);
    expect(filterByKind(all, null)).toHaveLength(4);
  });

  it("lists only kinds that can be ordered now, with counts", () => {
    expect(availableKinds(all)).toEqual([{ kind: "cushion", count: 1 }, { kind: "tote", count: 2 }]);
  });

  it("orders the shelf: orderable, then partly sold, then too small", () => {
    expect(shelfOrder(all).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("ShopGrid", () => {
  it("renders an anchor, chips and a card per remnant with honest notes", () => {
    const html = renderToStaticMarkup(createElement(ShopGrid, { remnants: all, allRemnants: all, kind: null }));
    expect(html).toContain('id="shop"');
    expect(html).toContain("Totes");
    expect(html).toContain("Cushions");
    expect(html.match(/<article/g)).toHaveLength(4);
    expect(html).toContain("Part of this piece is sold");
    expect(html).toContain("Too small for anything in our pattern book.");
  });

  it("says a fully ordered piece is spoken for, not too small", () => {
    const html = renderToStaticMarkup(createElement(ShopGrid, { remnants: [e], allRemnants: [e], kind: null }));
    expect(html).toContain("Fully spoken for");
    expect(html).not.toContain("Too small");
    expect(html).not.toContain("0 offers");
  });

  it("marks the active chip", () => {
    const html = renderToStaticMarkup(createElement(ShopGrid, { remnants: filterByKind(all, "tote"), allRemnants: all, kind: "tote" }));
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain("from $70");
  });

  it("shows the empty state", () => {
    expect(renderToStaticMarkup(createElement(ShopGrid, { remnants: [], allRemnants: [], kind: null }))).toContain("No pieces on the table right now.");
    expect(renderToStaticMarkup(createElement(ShopGrid, { remnants: [], allRemnants: all, kind: "tote" }))).toContain("See everything");
  });
});
