import {createHash, timingSafeEqual} from "node:crypto";

export const MIN_WORKSHOP_PIN_LENGTH = 12;

export type PinCheck = "ok" | "unauthorized" | "unconfigured";

export function constantTimeSecretEqual(expected: string, supplied: string): boolean {
  // Hashing first keeps both inputs at a fixed length, including malformed
  // or attacker-controlled values, before timingSafeEqual is called.
  const expectedBytes = createHash("sha256").update(expected, "utf8").digest();
  const suppliedBytes = createHash("sha256").update(supplied, "utf8").digest();
  return timingSafeEqual(expectedBytes, suppliedBytes);
}

/** Checks the x-workshop-pin header against WORKSHOP_PIN. */
export function checkWorkshopPin(headers: Headers, environment: Record<string, string | undefined> = process.env): PinCheck {
  const configured = environment.WORKSHOP_PIN?.trim();
  if (!configured || configured.length < MIN_WORKSHOP_PIN_LENGTH) return "unconfigured";
  const supplied = headers.get("x-workshop-pin");
  return supplied && constantTimeSecretEqual(configured, supplied) ? "ok" : "unauthorized";
}
