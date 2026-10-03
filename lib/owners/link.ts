import {createHmac, timingSafeEqual} from "node:crypto";

type Environment = Record<string, string | undefined>;

/**
 * A private key for one owner, derived from the server secret. It lets that owner decide consent on
 * their own pieces without the workshop PIN. It carries no expiry, so rotate ORDER_ENCRYPTION_KEY to revoke every link.
 */
export function ownerKey(ownerId: string, environment: Environment = process.env): string | null {
  const secret = environment.ORDER_ENCRYPTION_KEY?.trim();
  if (!secret || !ownerId) return null;
  return createHmac("sha256", secret).update(`tessom-owner-link:v1:${ownerId}`).digest("base64url");
}

export function verifyOwnerKey(ownerId: string, key: string | null | undefined, environment: Environment = process.env): boolean {
  const expected = ownerKey(ownerId, environment);
  if (!expected || !key) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Path the workshop sends to an owner, or null when the server secret is not configured. */
export function ownerLinkPath(ownerId: string, environment: Environment = process.env): string | null {
  const key = ownerKey(ownerId, environment);
  return key ? `/owner/${encodeURIComponent(ownerId)}?key=${key}` : null;
}
