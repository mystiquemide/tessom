import type {Metadata} from "next";
import {notFound} from "next/navigation";

import {OwnerView} from "../../../../components/owner-view";
import {fetchOwners} from "../../../../lib/owners";
import {verifyOwnerKey} from "../../../../lib/owners/link";
import {createSanityServerClient} from "../../../../lib/sanity/client";

export const dynamic = "force-dynamic";

type Props = {params: Promise<{id: string}>; searchParams: Promise<{key?: string | string[]}>};

export async function generateMetadata({params}: Pick<Props, "params">): Promise<Metadata> {
  const {id} = await params;
  try {
    const owner = (await fetchOwners(createSanityServerClient())).find((candidate) => candidate.id === id);
    return {title: owner ? `${owner.name} | Tessom` : "Not found | Tessom", robots: {index: false}};
  } catch {
    return {title: "Owner | Tessom", robots: {index: false}};
  }
}

export default async function OwnerPage({params, searchParams}: Props) {
  const {id} = await params;
  const {key} = await searchParams;
  const owner = (await fetchOwners(createSanityServerClient())).find((candidate) => candidate.id === id);
  if (!owner) notFound();
  const suppliedKey = typeof key === "string" ? key : null;
  return <OwnerView owner={owner} decisionKey={verifyOwnerKey(owner.id, suppliedKey) ? suppliedKey : null} />;
}
