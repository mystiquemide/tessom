import type {Metadata} from "next";
import {notFound} from "next/navigation";

import {RemnantView} from "../../../../components/remnant-view";
import {fetchShopRemnants, findShopRemnant} from "../../../../lib/shop";

export const dynamic = "force-dynamic";

type Params = {params: Promise<{id: string}>};

export async function generateMetadata({params}: Params): Promise<Metadata> {
  const {id} = await params;
  const remnant = findShopRemnant(await fetchShopRemnants(), id);
  return remnant ? {title: `${remnant.title} | Tessom`, description: `${remnant.title}, ${remnant.widthCm} by ${remnant.heightCm} cm. One of one.`} : {title: "Not found | Tessom"};
}

export default async function RemnantPage({params}: Params) {
  const {id} = await params;
  const remnant = findShopRemnant(await fetchShopRemnants(), id);
  if (!remnant) notFound();
  return <RemnantView remnant={remnant} />;
}
