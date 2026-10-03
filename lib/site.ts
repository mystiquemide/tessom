/** The public address of the site, for share previews, robots and the sitemap. */
export function siteUrl(environment: Record<string, string | undefined> = process.env): string {
  const explicit = environment.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const platform = environment.VERCEL_PROJECT_PRODUCTION_URL?.trim() || environment.VERCEL_URL?.trim();
  if (platform) return `https://${platform}`;
  return "http://localhost:3000";
}
