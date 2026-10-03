import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../app/api/owner/consent/route";
import { ownerKey } from "../../lib/owners/link";

const advanceWorkflow = vi.fn();
let remnantRow: { ownerId?: string; status?: string } | null = null;

vi.mock("../../app/api/workflow/advance/route", () => ({ advanceWorkflow: (...args: unknown[]) => advanceWorkflow(...args) }));
vi.mock("../../lib/sanity/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/sanity/client")>()),
  createSanityServerClient: () => ({ fetch: async () => remnantRow }),
}));

const call = (body: unknown) => POST(new Request("http://x/api/owner/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("POST /api/owner/consent", () => {
  let key: string;
  const valid = () => ({ ownerId: "owner-1", remnantId: "remnant-1", decision: "grant", key });

  beforeEach(() => {
    process.env.ORDER_ENCRYPTION_KEY = "s".repeat(43) + "=";
    key = ownerKey("owner-1")!;
    remnantRow = { ownerId: "owner-1", status: "intake" };
    advanceWorkflow.mockReset();
    advanceWorkflow.mockResolvedValue({});
  });

  it("rejects malformed bodies", async () => {
    expect((await call({ ownerId: "owner-1" })).status).toBe(400);
    expect((await call({ ...valid(), extra: true })).status).toBe(400);
    expect((await call({ ...valid(), decision: "maybe" })).status).toBe(400);
  });

  it("rejects a key that belongs to another owner or is wrong", async () => {
    expect((await call({ ...valid(), key: ownerKey("owner-2")! })).status).toBe(401);
    expect((await call({ ...valid(), key: "nope" })).status).toBe(401);
    expect(advanceWorkflow).not.toHaveBeenCalled();
  });

  it("will not touch a piece that belongs to someone else", async () => {
    remnantRow = { ownerId: "owner-2", status: "intake" };
    expect((await call(valid())).status).toBe(404);
    remnantRow = null;
    expect((await call(valid())).status).toBe(404);
    expect(advanceWorkflow).not.toHaveBeenCalled();
  });

  it("will not decide a piece twice", async () => {
    remnantRow = { ownerId: "owner-1", status: "listed" };
    expect((await call(valid())).status).toBe(409);
    expect(advanceWorkflow).not.toHaveBeenCalled();
  });

  it("grants and declines through the workflow, without any workshop PIN", async () => {
    expect((await call(valid())).status).toBe(200);
    expect(advanceWorkflow).toHaveBeenLastCalledWith({ action: "grant", remnantId: "remnant-1" });
    remnantRow = { ownerId: "owner-1", status: "consented" };
    expect((await call({ ...valid(), decision: "decline" })).status).toBe(200);
    expect(advanceWorkflow).toHaveBeenLastCalledWith({ action: "decline", remnantId: "remnant-1" });
  });

  it("hides workflow failures behind a plain message", async () => {
    advanceWorkflow.mockRejectedValue(new Error("secret internals"));
    const response = await call(valid());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret internals");
  });
});
