import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OrderStatusView } from "../components/order-status-view";
import { buildOrderStatus } from "../lib/order-status";

const raw = {
  _id: "orders.abc123",
  createdAt: "2026-10-03T09:00:00Z",
  price: 113.14,
  placement: [{ x: 0, y: 0, w: 47, h: 47, rotated: false }],
  templateName: "Square Cushion",
  remnantTitle: "Sage Crepe",
  widthCm: 200,
  heightCm: 110,
  stage: "cut",
};

describe("buildOrderStatus", () => {
  it("maps the workflow stage to a buyer-facing step", () => {
    expect(buildOrderStatus({ ...raw, stage: "allocated" })!.step).toBe("Reserved");
    expect(buildOrderStatus({ ...raw, stage: "cut" })!.step).toBe("Cut");
    expect(buildOrderStatus({ ...raw, stage: "sewn" })!.step).toBe("Sewn");
    expect(buildOrderStatus({ ...raw, stage: "sold-out" })!.step).toBe("Shipped");
    expect(buildOrderStatus({ ...raw, stage: null })!.step).toBe("Reserved");
  });

  it("keeps only what the buyer may see, never contact details", () => {
    const status = buildOrderStatus({ ...raw, buyerContact: { ciphertext: "x" }, buyerName: "Ada", buyerEmail: "ada@example.com" } as never)!;
    expect(JSON.stringify(status)).not.toMatch(/ada|ciphertext|buyer/i);
    expect(status).toMatchObject({ id: "orders.abc123", title: "Sage Crepe", productName: "Square Cushion", price: 113.14, orderedOn: "October 3, 2026" });
    expect(status.pieces).toEqual([{ x: 0, y: 0, w: 47, h: 47 }]);
  });

  it("returns null when there is no order or its fabric is missing", () => {
    expect(buildOrderStatus(null)).toBeNull();
    expect(buildOrderStatus({ _id: "o", widthCm: null, heightCm: null })).toBeNull();
  });
});

describe("OrderStatusView", () => {
  const order = buildOrderStatus({ ...raw, stage: "cut" })!;

  it("shows the order, the steps with the current one marked, and a plain message", () => {
    const html = renderToStaticMarkup(createElement(OrderStatusView, { order }));
    expect(html).toContain("Your order");
    expect(html).toContain("Order number: abc123");
    expect(html).toContain("Square Cushion from Sage Crepe");
    expect(html).toContain("$113.14");
    for (const step of ["Reserved", "Cut", "Sewn", "Shipped"]) expect(html).toContain(step);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain("Your pieces are cut.");
  });

  it("promises the workshop contact only while the order is reserved", () => {
    const allocated = renderToStaticMarkup(createElement(OrderStatusView, { order: buildOrderStatus({ ...raw, stage: "allocated" })! }));
    expect(allocated).toContain("The workshop will contact you at the email you gave to arrange payment and shipping. You pay nothing now.");
    expect(renderToStaticMarkup(createElement(OrderStatusView, { order }))).not.toContain("will contact you at the email you gave");
  });
});
