import Link from "next/link";

import {formatPrice, fromPrice, type ShopRemnant} from "../lib/shop";
import {CutPlan} from "./cut-plan";

const TILTS = ["-rotate-[1.5deg]", "rotate-[1deg] md:translate-y-10", "rotate-[2deg]"] as const;

function ConsentPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill bg-paper px-3 py-1 font-mono text-[14px] leading-[1.71] text-teal shadow-hairline">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <circle cx="8" cy="8" r="8" fill="#10756a" />
        <path d="M4.5 8.3l2.2 2.2 4.8-4.9" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Consent granted
    </span>
  );
}

function HeroCard({remnant, tilt}: {remnant: ShopRemnant; tilt: string}) {
  const price = fromPrice(remnant);
  const first = remnant.offers[0];
  return (
    <article
      className={`w-full max-w-[420px] rounded-feature bg-paper p-5 shadow-card transition-shadow hover:shadow-lift md:-ml-4 md:first:ml-0 ${tilt}`}
    >
      <div className="relative">
        <CutPlan
          widthCm={remnant.widthCm}
          heightCm={remnant.heightCm}
          photoUrl={remnant.photoUrl}
          ariaLabel={`${remnant.title}, ${remnant.widthCm} by ${remnant.heightCm} centimetres, ${remnant.offers.length} offers drawn on the fabric`}
          defects={remnant.defects}
          allocations={remnant.allocations}
          offers={remnant.offers}
          activeOfferId={first?.id ?? null}
          className="border border-charcoal/60"
        />
        <div className="absolute bottom-3 left-3">
          <ConsentPill />
        </div>
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-[20px] font-medium leading-[1.3] text-ink">{remnant.title}</h3>
        {price !== null && <p className="font-mono text-[14px] text-ink">from {formatPrice(price)}</p>}
      </div>
      <p className="mt-1 font-mono text-[14px] leading-[1.71] text-muted">
        {remnant.widthCm} × {remnant.heightCm} cm · {remnant.offers.length} {remnant.offers.length === 1 ? "offer" : "offers"}
      </p>
    </article>
  );
}

export function Hero({remnants}: {remnants: readonly ShopRemnant[]}) {
  return (
    <section className="mx-auto max-w-page px-6 pb-4 pt-16 sm:pt-24">
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="text-[clamp(38px,6.4vw,58px)] leading-[1.2] text-ink">Every offcut has a next piece.</h1>
        <p className="mx-auto mt-5 max-w-[560px] text-[16px] leading-[1.63] text-body">
          Premium upholstery fabric, cut into one-off cushions, pads and totes from what the workshop had left.
        </p>
        <Link
          href="/shop"
          className="mt-8 inline-flex items-center gap-2 rounded-pill bg-ink px-5 py-2 text-[16px] font-semibold text-paper"
        >
          Browse pieces
          <span aria-hidden="true" className="opacity-60">
            →
          </span>
        </Link>
      </div>

      {remnants.length > 0 && (
        <div className="relative mt-20 flex flex-col items-center gap-8 pb-14 md:flex-row md:items-start md:justify-center md:gap-0">
          {remnants.map((remnant, index) => (
            <HeroCard key={remnant.id} remnant={remnant} tilt={TILTS[index % TILTS.length]} />
          ))}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-9 right-2 hidden -rotate-[3deg] border border-stamp/30 px-3 py-1 font-stamp text-[36px] uppercase leading-none text-stamp md:block lg:right-16"
          >
            One of one
          </span>
        </div>
      )}
    </section>
  );
}
