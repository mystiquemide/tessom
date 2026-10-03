import type {Metadata} from "next";
import Link from "next/link";

import {fetchOwners} from "../../../lib/owners";
import {createSanityServerClient} from "../../../lib/sanity/client";
import {formatPrice} from "../../../lib/shop";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Owners | Tessom",
  description: "The people whose fabric is on the table, and what their pieces have earned.",
};

async function loadOwners() {
  try {
    return await fetchOwners(createSanityServerClient());
  } catch {
    return null;
  }
}

export default async function OwnersPage() {
  const owners = await loadOwners();
  return (
    <main className="mx-auto max-w-page px-6 pb-4 pt-16 sm:pt-20">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-[clamp(32px,5vw,44px)] leading-[1.25] text-ink">The people behind the fabric.</h1>
        <p className="mt-3 text-[16px] leading-[1.63] text-body">
          Every offcut belongs to someone. Owners say yes before anything is listed, and earn a share of each cut. Earnings are accrued from orders, and no payments are made on this site.
        </p>
      </div>

      {owners === null && <p className="mx-auto mt-12 max-w-md text-center text-[16px] text-body">We couldn&apos;t load the owners. Try again in a moment.</p>}
      {owners !== null && owners.length === 0 && <p className="mx-auto mt-12 max-w-md text-center font-serif text-[20px] text-ink">No owners yet.</p>}
      {owners !== null && owners.length > 0 && (
        <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {owners.map((owner) => (
            <li key={owner.id}>
              <Link href={`/owner/${encodeURIComponent(owner.id)}`} className="block rounded-feature bg-paper p-5 shadow-card transition-shadow hover:shadow-lift">
                <h2 className="font-serif text-[20px] font-medium leading-[1.3] text-ink">{owner.name}</h2>
                <p className="mt-1 font-mono text-[14px] leading-[1.71] text-muted">{owner.kindLabel}</p>
                <p className="mt-4 font-mono text-[14px] leading-[1.71] text-ink">
                  {owner.remnants.length} {owner.remnants.length === 1 ? "piece" : "pieces"}
                  <span className="text-rust"> · earned {formatPrice(owner.earned)}</span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
