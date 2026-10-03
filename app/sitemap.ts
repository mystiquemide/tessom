import type {MetadataRoute} from "next";

import {siteUrl} from "../lib/site";
import {fetchShopRemnants} from "../lib/shop";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const pages = ["", "/shop", "/owner", "/privacy"].map((path) => ({url: `${base}${path}`}));
  const remnants = await fetchShopRemnants();
  return [...pages, ...remnants.map((remnant) => ({url: `${base}/r/${remnant.id}`}))];
}
