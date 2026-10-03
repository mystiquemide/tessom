import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyOwnerKey } from "../../lib/owners/link";
import { buildBoard, orderColumn, type RawBoard } from "../../lib/workshop/board";

const KEY = randomBytes(32).toString("base64");
const env = { ORDER_ENCRYPTION_KEY: KEY };

function encrypt(buyerName: string, buyerEmail: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(KEY, "base64"), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ buyerName, buyerEmail }), "utf8"), cipher.final()]);
  return { algorithm: "aes-256-gcm", version: 1, iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

const data: RawBoard = {
  remnants: [
    { _id: "r1", title: "Teal Trellis", status: "listed", widthCm: 160, heightCm: 100, owner: "Clara Morrow", ownerId: "owner-1" },
    { _id: "r2", title: "Rose Clay Stripe", status: "consented", widthCm: 90, heightCm: 70, owner: null, ownerId: "owner-2" },
    { _id: "r3", title: "Petrol Cord", status: "intake", widthCm: 60, heightCm: 50 },
  ],
  orders: [
    { _id: "o1", createdAt: "2026-10-03T09:00:00Z", price: 80.55, workflowInstanceId: "i1", buyerContact: encrypt("Ada Lovelace", "ada@example.com"), remnantTitle: "Sage Crepe", templateName: "Lumbar Cushion", stage: "allocated" },
    { _id: "o2", workflowInstanceId: "i2", remnantTitle: "Dune Stripe", templateName: "Market Tote", stage: "cut" },
    { _id: "o3", workflowInstanceId: "i3", remnantTitle: "Champagne Satin", templateName: "Seat Pad", stage: "sewn" },
    { _id: "o4", workflowInstanceId: "i4", remnantTitle: "Poppy Twill", templateName: "Bench Pad", stage: "sold-out" },
  ],
};

describe("orderColumn", () => {
  it("maps stages to columns and treats anything past sewn as shipped", () => {
    expect(orderColumn("allocated")).toBe("allocated");
    expect(orderColumn("cut")).toBe("cut");
    expect(orderColumn("sewn")).toBe("sewn");
    expect(orderColumn("shipped")).toBe("shipped");
    expect(orderColumn("sold-out")).toBe("shipped");
    expect(orderColumn(undefined)).toBe("allocated");
  });
});

describe("buildBoard", () => {
  const board = buildBoard(data, env);
  const column = (id: string) => board.find((c) => c.id === id)!;

  it("has the six columns in order", () => {
    expect(board.map((c) => c.id)).toEqual(["awaiting-consent", "listed", "allocated", "cut", "sewn", "shipped"]);
  });

  it("puts unconsented remnants under awaiting consent and listed ones under listed, read only", () => {
    expect(column("awaiting-consent").cards.map((c) => c.title)).toEqual(["Rose Clay Stripe", "Petrol Cord"]);
    expect(column("listed").cards.map((c) => c.title)).toEqual(["Teal Trellis"]);
    expect([...column("awaiting-consent").cards, ...column("listed").cards].every((c) => c.action === undefined)).toBe(true);
    expect(column("listed").cards[0].subtitle).toBe("Owner: Clara Morrow");
  });

  it("gives awaiting-consent cards a working private owner link and nothing else", () => {
    const rose = column("awaiting-consent").cards.find((c) => c.title === "Rose Clay Stripe")!;
    expect(rose.ownerLink).toMatch(/^\/owner\/owner-2\?key=/);
    const key = new URL(rose.ownerLink!, "http://x").searchParams.get("key");
    expect(verifyOwnerKey("owner-2", key, env)).toBe(true);
    expect(verifyOwnerKey("owner-1", key, env)).toBe(false);
    expect(column("awaiting-consent").cards.find((c) => c.title === "Petrol Cord")!.ownerLink).toBeUndefined();
    expect(column("listed").cards[0].ownerLink).toBeUndefined();
    expect(column("allocated").cards[0].ownerLink).toBeUndefined();
  });

  it("gives each order the next real action and shows only the buyer's first name", () => {
    const allocated = column("allocated").cards[0];
    expect(allocated.action).toEqual({ name: "mark-cut", label: "Mark cut" });
    expect(allocated.details).toContain("For Ada");
    expect(JSON.stringify(board)).not.toContain("Lovelace");
    expect(JSON.stringify(board)).not.toContain("ada@example.com");
    expect(allocated.subtitle).toBe("Lumbar Cushion · $80.55");
    expect(column("cut").cards[0].action).toEqual({ name: "mark-sewn", label: "Mark sewn" });
    expect(column("sewn").cards[0].action).toEqual({ name: "mark-shipped", label: "Mark shipped" });
  });

  it("shows shipped orders with no action", () => {
    expect(column("shipped").cards.map((c) => c.title)).toEqual(["Poppy Twill"]);
    expect(column("shipped").cards[0].action).toBeUndefined();
  });

  it("omits the buyer when the contact cannot be read", () => {
    const wrongKey = buildBoard(data, { ORDER_ENCRYPTION_KEY: randomBytes(32).toString("base64") });
    expect(wrongKey.find((c) => c.id === "allocated")!.cards[0].details.some((line) => line.startsWith("For"))).toBe(false);
  });
});
