import type { NextConfig } from "next";

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

// Next needs inline scripts and styles to hydrate. Everything else is limited to this site and the Sanity image CDN.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://cdn.sanity.io",
  "font-src 'self' data:",
  "connect-src 'self' https://*.api.sanity.io",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "cdn.sanity.io" }],
  },
  // The Vercel addresses serve the same site. Send them to the main domain so there is one canonical address.
  async redirects() {
    return ["tessom.vercel.app", "tessom-mide27145-3891s-projects.vercel.app"].map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: "https://tessom.midelabs.xyz/:path*",
      permanent: true,
    }));
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // Studio loads scripts, workers and sockets from several Sanity hosts, so it keeps the baseline headers only.
      { source: "/((?!studio).*)", headers: [{ key: "Content-Security-Policy", value: CSP }] },
    ];
  },
};

export default nextConfig;
