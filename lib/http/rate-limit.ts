import {NextResponse} from "next/server";

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the oldest hit leaves the window. */
  retryAfterSec: number;
}

export interface RateLimiter {
  /** Counts this hit and says whether it is within the limit. */
  check(key: string, now?: number): RateLimitResult;
  /** True when the key is already at the limit. Does not count a hit. */
  blocked(key: string, now?: number): RateLimitResult;
  /** Counts a hit without judging it. */
  record(key: string, now?: number): void;
}

interface Options {
  limit: number;
  windowMs: number;
  /** Limits are skipped under test so route tests can call handlers freely. Set to true to test the limiter itself. */
  enforceInTests?: boolean;
}

const MAX_KEYS = 10_000;

/**
 * A sliding-window limiter held in memory. It slows scripts down on one server instance.
 * It is not shared across serverless instances, so it is a speed bump, not a guarantee.
 */
export function createRateLimiter({limit, windowMs, enforceInTests = false}: Options): RateLimiter {
  const hits = new Map<string, number[]>();
  const skip = process.env.NODE_ENV === "test" && !enforceInTests;

  function fresh(key: string, now: number): number[] {
    const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
    if (recent.length > 0) hits.set(key, recent);
    else hits.delete(key);
    return recent;
  }

  function result(recent: number[], now: number): RateLimitResult {
    if (recent.length < limit) return {allowed: true, retryAfterSec: 0};
    return {allowed: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000))};
  }

  return {
    check(key, now = Date.now()) {
      if (skip) return {allowed: true, retryAfterSec: 0};
      const recent = fresh(key, now);
      const verdict = result(recent, now);
      if (verdict.allowed) {
        if (hits.size >= MAX_KEYS) hits.delete(hits.keys().next().value as string);
        hits.set(key, [...recent, now]);
      }
      return verdict;
    },
    blocked(key, now = Date.now()) {
      if (skip) return {allowed: true, retryAfterSec: 0};
      return result(fresh(key, now), now);
    },
    record(key, now = Date.now()) {
      if (skip) return;
      if (hits.size >= MAX_KEYS) hits.delete(hits.keys().next().value as string);
      hits.set(key, [...fresh(key, now), now]);
    },
  };
}

/** Best guess at who is calling. Behind a proxy this is the first forwarded address. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function tooManyRequests(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    {error: "Too many requests. Try again in a few minutes."},
    {status: 429, headers: {"Retry-After": String(retryAfterSec), "Cache-Control": "no-store"}},
  );
}
