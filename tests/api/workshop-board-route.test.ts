import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../../app/api/workshop/board/route";

vi.mock("../../lib/sanity/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/sanity/client")>()),
  createSanityServerClient: () => ({ fetch: async () => ({ remnants: [{ _id: "r1", title: "Teal", status: "listed", widthCm: 10, heightCm: 10 }], orders: [] }) }),
}));

const PIN = "a-long-workshop-pin-123";
const call = (pin?: string) => GET(new Request("http://x/api/workshop/board", { headers: pin ? { "x-workshop-pin": pin } : {} }));

describe("GET /api/workshop/board", () => {
  beforeEach(() => {
    process.env.WORKSHOP_PIN = PIN;
  });

  it("refuses a missing or wrong PIN", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("wrong-wrong-wrong")).status).toBe(401);
  });

  it("reports an unconfigured server instead of letting anyone in", async () => {
    process.env.WORKSHOP_PIN = "short";
    expect((await call("short")).status).toBe(503);
    delete process.env.WORKSHOP_PIN;
    expect((await call("anything")).status).toBe(503);
  });

  it("returns the six columns for the right PIN, uncached", async () => {
    const response = await call(PIN);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { columns: { id: string; cards: unknown[] }[] };
    expect(body.columns).toHaveLength(6);
    expect(body.columns.find((c) => c.id === "listed")!.cards).toHaveLength(1);
  });
});
