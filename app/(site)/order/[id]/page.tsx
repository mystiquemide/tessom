import type {Metadata} from "next";
import {notFound} from "next/navigation";

import {OrderStatusView} from "../../../../components/order-status-view";
import {SANITY_DOCUMENT_ID_PATTERN} from "../../../../lib/http/sanity-id";
import {fetchOrderStatus} from "../../../../lib/order-status";
import {createSanityServerClient} from "../../../../lib/sanity/client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your order | Tessom",
  robots: {index: false, follow: false},
};

export default async function OrderPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  if (!SANITY_DOCUMENT_ID_PATTERN.test(id)) notFound();
  const order = await fetchOrderStatus(createSanityServerClient(), id);
  if (!order) notFound();
  return <OrderStatusView order={order} />;
}
