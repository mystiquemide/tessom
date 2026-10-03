import {BuiltOn} from "../../components/built-on";
import {ClosingCta} from "../../components/closing-cta";
import {Hero} from "../../components/hero";
import {HowItWorks} from "../../components/how-it-works";
import {Stats} from "../../components/stats";
import {fetchShopRemnants, orderable, shopStats} from "../../lib/shop";

export const dynamic = "force-dynamic";

export default async function Home() {
  const all = await fetchShopRemnants();
  const open = orderable(all);
  return (
    <>
      <Hero remnants={open.slice(0, 3)} />
      <Stats stats={shopStats(all)} />
      {open.length > 0 && <HowItWorks remnants={[open[3] ?? open[0], open[4] ?? open[1] ?? open[0], open[5] ?? open[2] ?? open[0]]} />}
      <BuiltOn />
      <ClosingCta />
    </>
  );
}
