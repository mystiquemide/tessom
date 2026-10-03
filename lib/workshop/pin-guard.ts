import {clientKey, createRateLimiter} from "../http/rate-limit";

/** Ten wrong PINs in ten minutes from one address locks that address out for the rest of the window. */
const failures = createRateLimiter({limit: 10, windowMs: 10 * 60 * 1000});

/** Seconds to wait if this caller has used up its wrong-PIN attempts, otherwise null. */
export function pinAttemptsBlocked(request: Request): number | null {
  const verdict = failures.blocked(clientKey(request));
  return verdict.allowed ? null : verdict.retryAfterSec;
}

export function recordPinFailure(request: Request): void {
  failures.record(clientKey(request));
}
