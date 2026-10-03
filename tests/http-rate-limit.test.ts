import { describe, expect, it } from "vitest";

import { clientKey, createRateLimiter, tooManyRequests } from "../lib/http/rate-limit";
import { siteUrl } from "../lib/site";

describe("createRateLimiter", () => {
  const make = () => createRateLimiter({ limit: 3, windowMs: 1000, enforceInTests: true });

  it("allows up to the limit and then refuses with a wait time", () => {
    const limiter = make();
    expect([1, 2, 3].map((i) => limiter.check("a", i).allowed)).toEqual([true, true, true]);
    const fourth = limiter.check("a", 4);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSec).toBe(1);
  });

  it("keeps callers apart and forgets old hits when the window passes", () => {
    const limiter = make();
    for (const t of [1, 2, 3]) limiter.check("a", t);
    expect(limiter.check("b", 4).allowed).toBe(true);
    expect(limiter.check("a", 5).allowed).toBe(false);
    expect(limiter.check("a", 1005).allowed).toBe(true);
  });

  it("blocked() judges without counting, and record() counts without judging", () => {
    const limiter = make();
    expect(limiter.blocked("p", 1).allowed).toBe(true);
    limiter.record("p", 1); limiter.record("p", 2); limiter.record("p", 3);
    expect(limiter.blocked("p", 4).allowed).toBe(false);
    expect(limiter.blocked("p", 4).retryAfterSec).toBeGreaterThan(0);
    expect(limiter.blocked("p", 2000).allowed).toBe(true);
  });

  it("does nothing under test unless asked, so route tests are not throttled", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect([limiter.check("x"), limiter.check("x"), limiter.check("x")].every((r) => r.allowed)).toBe(true);
  });
});

describe("clientKey and tooManyRequests", () => {
  it("uses the first forwarded address, then the real IP, then unknown", () => {
    expect(clientKey(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }))).toBe("1.2.3.4");
    expect(clientKey(new Request("http://x", { headers: { "x-real-ip": "5.6.7.8" } }))).toBe("5.6.7.8");
    expect(clientKey(new Request("http://x"))).toBe("unknown");
  });

  it("answers 429 with Retry-After and no caching", async () => {
    const response = tooManyRequests(42);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Too many requests. Try again in a few minutes." });
  });
});

describe("siteUrl", () => {
  it("prefers the explicit URL, then the platform URL, then localhost", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://tessom.example/" })).toBe("https://tessom.example");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "tessom.vercel.app" })).toBe("https://tessom.vercel.app");
    expect(siteUrl({ VERCEL_URL: "tessom-abc.vercel.app" })).toBe("https://tessom-abc.vercel.app");
    expect(siteUrl({})).toBe("http://localhost:3000");
  });
});
