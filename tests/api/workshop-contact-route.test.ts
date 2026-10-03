import { createCipheriv, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../app/api/workshop/contact/route";

const KEY = randomBytes(32).toString("base64");
const PIN = "a-long-workshop-pin-123";

function encrypt(buyerName: string, buyerEmail: string, key = KEY) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ buyerName, buyerEmail }), "utf8"), cipher.final()]);
  return { algorithm: "aes-256-gcm", version: 1, iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

let order: { buyerContact?: unknown } | null = null;
vi.mock("../../lib/sanity/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/sanity/client")>()),
  createSanityServerClient: () => ({ fetch: async () => order }),
}));

const call = (body: unknown, pin: string | null = PIN) =>
  POST(new Request("http://x/api/workshop/contact", { method: "POST", headers: { "content-type": "application/json", ...(pin ? { "x-workshop-pin": pin } : {}) }, body: JSON.stringify(body) }));

describe("POST /api/workshop/contact", () => {
  beforeEach(() => {
    process.env.WORKSHOP_PIN = PIN;
    process.env.ORDER_ENCRYPTION_KEY = KEY;
    order = { buyerContact: encrypt("Ada Lovelace", "ada@example.com") };
  });

  it("needs the workshop PIN", async () => {
    expect((await call({ orderId: "orders.abc" }, null)).status).toBe(401);
    expect((await call({ orderId: "orders.abc" }, "wrong-wrong-wrong")).status).toBe(401);
    process.env.WORKSHOP_PIN = "short";
    expect((await call({ orderId: "orders.abc" }, "short")).status).toBe(503);
  });

  it("rejects bad bodies", async () => {
    expect((await call({})).status).toBe(400);
    expect((await call({ orderId: "../x" })).status).toBe(400);
    expect((await call({ orderId: "orders.abc", extra: 1 })).status).toBe(400);
  });

  it("returns the buyer's name and email to the workshop, uncached", async () => {
    const response = await call({ orderId: "orders.abc" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ name: "Ada Lovelace", email: "ada@example.com" });
  });

  it("says not found for a missing order and hides decrypt failures", async () => {
    order = null;
    expect((await call({ orderId: "orders.nope" })).status).toBe(404);
    order = { buyerContact: encrypt("Ada", "ada@example.com", randomBytes(32).toString("base64")) };
    const response = await call({ orderId: "orders.abc" });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("ada@example.com");
  });
});
