import type {Metadata} from "next";

import {ShopGrid} from "../../../components/shop-grid";
import {fetchShopRemnants, filterByKind, isShopKind} from "../../../lib/shop";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shop | Tessom",
  description: "One-off cushions, pads and totes, cut from premium upholstery offcuts.",
};

export default async function ShopPage({searchParams}: {searchParams: Promise<{kind?: string | string[]}>}) {
  const {kind: rawKind} = await searchParams;
  const kind = isShopKind(rawKind) ? rawKind : null;
  const all = await fetchShopRemnants();
  return <ShopGrid remnants={filterByKind(all, kind)} allRemnants={all} kind={kind} />;
}
