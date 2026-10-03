import Link from "next/link";

import {availableKinds, formatPrice, fromPrice, KIND_LABELS, shelfOrder, type ShopKind, type ShopRemnant} from "../lib/shop";
import {CutPlan} from "./cut-plan";

function chipClass(active: boolean): string {
  return `inline-flex items-center rounded-pill px-4 py-2 text-[14px] font-medium leading-none transition-colors ${
    active ? "bg-ink text-paper" : "bg-paper text-ink shadow-hairline hover:shadow-card"
  }`;
}

function ShopCard({remnant}: {remnant: ShopRemnant}) {
  const price = fromPrice(remnant);
  const partlySold = remnant.status === "allocated" && remnant.offers.length > 0;
  const spokenFor = remnant.offers.length === 0 && remnant.allocations.length > 0;
  const tooSmall = remnant.offers.length === 0 && !spokenFor;
  return (
    <article className="rounded-feature bg-paper p-5 shadow-card transition-shadow hover:shadow-lift">
      <CutPlan
        widthCm={remnant.widthCm}
        heightCm={remnant.heightCm}
        photoUrl={remnant.photoUrl}
        ariaLabel={`${remnant.title}, ${remnant.widthCm} by ${remnant.heightCm} centimetres, ${remnant.offers.length} ways to cut it`}
        defects={remnant.defects}
        allocations={remnant.allocations}
        offers={remnant.offers}
        activeOfferId={remnant.offers[0]?.id ?? null}
        className="border border-charcoal/60"
      />
      <div className="mt-4 flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-[20px] font-medium leading-[1.3] text-ink">{remnant.title}</h3>
        {price !== null && <p className="shrink-0 font-mono text-[14px] text-ink">from {formatPrice(price)}</p>}
      </div>
      <p className="mt-1 font-mono text-[14px] leading-[1.71] text-muted">
        {remnant.widthCm} × {remnant.heightCm} cm
        {remnant.offers.length === 0 ? "" : ` · ${remnant.offers.length} ${remnant.offers.length === 1 ? "offer" : "offers"}`}
      </p>
      {partlySold && <p className="mt-2 text-[14px] leading-[1.71] text-body">Part of this piece is sold. What&apos;s left is below.</p>}
      {spokenFor && <p className="mt-2 text-[14px] leading-[1.71] text-body">Fully spoken for. Every cut from this piece has been ordered.</p>}
      {tooSmall && <p className="mt-2 text-[14px] leading-[1.71] text-body">Too small for anything in our pattern book.</p>}
    </article>
  );
}

export function ShopGrid({remnants, allRemnants, kind}: {remnants: readonly ShopRemnant[]; allRemnants: readonly ShopRemnant[]; kind: ShopKind | null}) {
  const kinds = availableKinds(allRemnants);
  const shelf = shelfOrder(remnants);

  return (
    <section id="shop" className="mx-auto max-w-page scroll-mt-6 px-6 pt-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-[clamp(28px,4.4vw,36px)] leading-[1.31] text-ink">On the table right now.</h2>
        <p className="mt-3 text-[16px] leading-[1.63] text-body">Each piece is one of one. Order a cut and the fabric it uses is gone.</p>
      </div>

      {kinds.length > 0 && (
        <nav aria-label="Filter by item" className="mt-8 flex flex-wrap justify-center gap-2">
          <Link href="/#shop" scroll={false} aria-current={kind === null ? "page" : undefined} className={chipClass(kind === null)}>
            All
          </Link>
          {kinds.map((entry) => (
            <Link
              key={entry.kind}
              href={`/?kind=${entry.kind}#shop`}
              scroll={false}
              aria-current={kind === entry.kind ? "page" : undefined}
              className={chipClass(kind === entry.kind)}
            >
              {KIND_LABELS[entry.kind]}
            </Link>
          ))}
        </nav>
      )}

      {shelf.length > 0 ? (
        <div className="mt-10 grid items-start gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {shelf.map((remnant) => (
            <ShopCard key={remnant.id} remnant={remnant} />
          ))}
        </div>
      ) : (
        <div className="mx-auto mt-12 max-w-md text-center">
          <p className="font-serif text-[20px] text-ink">{kind === null ? "No pieces on the table right now." : "Nothing on the table fits that yet."}</p>
          {kind !== null && (
            <Link href="/#shop" scroll={false} className="mt-4 inline-flex rounded-pill bg-ink px-5 py-2 text-[16px] font-semibold text-paper">
              See everything
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
