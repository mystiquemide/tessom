"use client";

import Image from "next/image";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useRef, useState} from "react";

import type {Rect} from "../lib/offers";
import {cutsLabel, describeOfferPieces, formatPrice, planningFacts, type ShopOffer, type ShopRemnant} from "../lib/shop";
import {CutPlan} from "./cut-plan";
import {OrderDialog, type PlacedOrder} from "./order-dialog";

interface Row {
  offer: ShopOffer;
  leaving: boolean;
}

export function RemnantView({remnant}: {remnant: ShopRemnant}) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(remnant.offers[0]?.id ?? null);
  const [dialogOffer, setDialogOffer] = useState<ShopOffer | null>(null);
  const [fresh, setFresh] = useState<Rect[]>([]);
  const [rows, setRows] = useState<Row[]>(() => remnant.offers.map((offer) => ({offer, leaving: false})));
  const previous = useRef<ShopOffer[]>(remnant.offers);

  useEffect(() => {
    const next = new Map(remnant.offers.map((offer) => [offer.id, offer]));
    const kept = previous.current.map((offer) => ({offer: next.get(offer.id) ?? offer, leaving: !next.has(offer.id)}));
    const added = remnant.offers.filter((offer) => !previous.current.some((old) => old.id === offer.id)).map((offer) => ({offer, leaving: false}));
    previous.current = remnant.offers;
    setRows([...kept, ...added]);
    if (!kept.some((row) => row.leaving)) return;
    const timer = setTimeout(() => setRows((current) => current.filter((row) => !row.leaving)), 700);
    return () => clearTimeout(timer);
  }, [remnant.offers]);

  const active = remnant.offers.some((offer) => offer.id === activeId) ? activeId : (remnant.offers[0]?.id ?? null);
  const spokenFor = remnant.offers.length === 0 && remnant.allocations.length + fresh.length > 0;

  function onPlaced(order: PlacedOrder) {
    setFresh(order.placement.map(({x, y, w, h}) => ({x, y, w, h})));
    router.refresh();
  }

  function onClose(changed: boolean) {
    setDialogOffer(null);
    if (changed) router.refresh();
  }

  return (
    <main id="main" className="mx-auto max-w-page px-6 pb-4 pt-10">
      <Link href="/shop" className="inline-flex min-h-11 items-center text-[14px] text-ink underline-offset-[6px] hover:underline">
        ← All pieces
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
        <div className="self-start lg:sticky lg:top-6">
          <div className="rounded-feature bg-paper p-5 shadow-card">
            <CutPlan
              widthCm={remnant.widthCm}
              heightCm={remnant.heightCm}
              photoUrl={remnant.photoUrl}
              ariaLabel={`${remnant.title}, ${remnant.widthCm} by ${remnant.heightCm} centimetres. ${cutsLabel(remnant.offers.length)}.`}
              defects={remnant.defects}
              allocations={remnant.allocations}
              freshAllocations={fresh}
              offers={remnant.offers}
              activeOfferId={active}
              className="border border-charcoal/60"
            />
          </div>
          <p className="mt-3 font-mono text-[14px] leading-[1.5] text-muted">Dashed blue shows where we cut. Hatching is a flaw. Each square on the grid is 10 cm.</p>
        </div>

        <div>
          <h1 className="text-[clamp(32px,5vw,44px)] leading-[1.25] text-ink">{remnant.title}</h1>
          <p className="mt-2 font-mono text-[14px] leading-[1.71] text-muted">
            {remnant.maker ? `${remnant.maker} · ` : ""}
            {remnant.widthCm} × {remnant.heightCm} cm
          </p>

          {rows.length > 0 ? (
            <section aria-label="Cuts for this offcut" className="mt-8">
              <p className="text-[14px] leading-[1.71] text-body">
                Each offcut is one of one. Order a cut and any other cut that needs the same fabric disappears. Product photos are examples, not made from this fabric.
              </p>
              <ul className="mt-4 space-y-3">
                {rows.map(({offer, leaving}) => (
                  <li
                    key={offer.id}
                    onMouseEnter={() => !leaving && setActiveId(offer.id)}
                    onFocus={() => !leaving && setActiveId(offer.id)}
                    className={`flex flex-col gap-4 rounded-feature bg-paper p-4 transition-all duration-700 sm:flex-row sm:items-center ${
                      leaving ? "pointer-events-none opacity-0" : active === offer.id ? "shadow-lift ring-1 ring-ink" : "shadow-card"
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-4">
                      {offer.imageUrl && (
                        <Image src={offer.imageUrl} alt="" width={72} height={72} loading="eager" className="size-[72px] shrink-0 rounded-card bg-recessed object-cover" />
                      )}
                      <div className="min-w-0 flex-1">
                        <h2 className="font-serif text-[20px] font-medium leading-[1.3] text-ink">{offer.name}</h2>
                        <p className="mt-0.5 font-mono text-[14px] leading-[1.5] text-muted">{describeOfferPieces(offer)}</p>
                        <p className="mt-1 font-mono text-[14px] leading-[1.71] text-ink">
                          {formatPrice(offer.price)} <span className="text-rust">· Includes {formatPrice(offer.ownerShare)} for the fabric&apos;s owner</span>
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDialogOffer(offer)}
                      aria-label={`Order ${offer.name} for ${formatPrice(offer.price)}`}
                      className="w-full min-h-11 shrink-0 rounded-pill bg-ink px-4 py-2 text-[14px] font-semibold text-paper sm:w-auto"
                    >
                      Order this cut →
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="mt-8 rounded-feature bg-paper p-5 shadow-card">
              <p className="font-serif text-[20px] leading-[1.3] text-ink">{spokenFor ? "Fully spoken for." : "Too small for anything in our pattern book."}</p>
              <p className="mt-2 text-[16px] leading-[1.63] text-body">
                {spokenFor ? "Every cut from this offcut has been ordered." : "None of our products fit in what is left of this offcut."}
              </p>
              <Link href="/shop" className="mt-4 inline-flex rounded-pill bg-ink px-5 py-2.5 text-[16px] font-semibold text-paper">
                See what else is on the table
              </Link>
            </section>
          )}

          <section aria-labelledby="planned" className="mt-10 border-t border-rule pt-8">
            <h2 id="planned" className="font-serif text-[28px] leading-[1.31] text-ink">
              How this piece was planned
            </h2>
            <ul className="mt-3 space-y-2 text-[16px] leading-[1.63] text-body">
              {planningFacts(remnant).map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {dialogOffer && <OrderDialog remnant={remnant} offer={dialogOffer} onClose={onClose} onPlaced={onPlaced} />}
    </main>
  );
}
