import { describe, expect, it } from "vitest";

import { ownerKey, ownerLinkPath, verifyOwnerKey } from "../../lib/owners/link";

const env = { ORDER_ENCRYPTION_KEY: "k".repeat(43) + "=" };

describe("owner keys", () => {
  it("is stable per owner and different between owners", () => {
    expect(ownerKey("owner-1", env)).toBe(ownerKey("owner-1", env));
    expect(ownerKey("owner-1", env)).not.toBe(ownerKey("owner-2", env));
  });

  it("verifies only the matching owner's key", () => {
    const key = ownerKey("owner-1", env)!;
    expect(verifyOwnerKey("owner-1", key, env)).toBe(true);
    expect(verifyOwnerKey("owner-2", key, env)).toBe(false);
    expect(verifyOwnerKey("owner-1", key.slice(0, -1) + (key.endsWith("A") ? "B" : "A"), env)).toBe(false);
    expect(verifyOwnerKey("owner-1", "", env)).toBe(false);
    expect(verifyOwnerKey("owner-1", null, env)).toBe(false);
    expect(verifyOwnerKey("owner-1", key + "x", env)).toBe(false);
  });

  it("changes when the server secret changes, which revokes old links", () => {
    const key = ownerKey("owner-1", env)!;
    expect(verifyOwnerKey("owner-1", key, { ORDER_ENCRYPTION_KEY: "other-secret" })).toBe(false);
  });

  it("refuses to make or accept keys without a server secret", () => {
    expect(ownerKey("owner-1", {})).toBeNull();
    expect(ownerLinkPath("owner-1", {})).toBeNull();
    expect(verifyOwnerKey("owner-1", "anything", {})).toBe(false);
  });

  it("builds the path the workshop sends", () => {
    expect(ownerLinkPath("owner-1", env)).toBe(`/owner/owner-1?key=${ownerKey("owner-1", env)}`);
  });
});
