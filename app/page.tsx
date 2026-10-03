import {Hero} from "../components/hero";
import {HowItWorks} from "../components/how-it-works";
import {ShopGrid} from "../components/shop-grid";
import {Stats} from "../components/stats";
import {fetchShopRemnants, filterByKind, isShopKind, orderable, shopStats} from "../lib/shop";

export const dynamic = "force-dynamic";

export default async function Home({searchParams}: {searchParams: Promise<{kind?: string | string[]}>}) {
  const {kind: rawKind} = await searchParams;
  const kind = isShopKind(rawKind) ? rawKind : null;

  const all = await fetchShopRemnants();
  const open = orderable(all);
  return (
    <>
      <Hero remnants={open.slice(0, 3)} />
      <Stats stats={shopStats(all)} />
      {open.length > 0 && <HowItWorks remnants={[open[3] ?? open[0], open[4] ?? open[1] ?? open[0], open[5] ?? open[2] ?? open[0]]} />}
      <ShopGrid remnants={filterByKind(all, kind)} allRemnants={all} kind={kind} />
    </>
  );
}
