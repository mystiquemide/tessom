import {Hero} from "../components/hero";
import {fetchShopRemnants, orderable} from "../lib/shop";

export const dynamic = "force-dynamic";

export default async function Home() {
  const remnants = orderable(await fetchShopRemnants());
  return <Hero remnants={remnants.slice(0, 3)} />;
}
