import type {Metadata} from "next";
import {notFound} from "next/navigation";

import {createSanityServerClient} from "../../../../lib/sanity/client";
import {buildOfferStatus, OFFER_REFERENCE_PATTERN} from "../../../../lib/submissions/status";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your offer | Tessom",
  robots: {index: false, follow: false},
};

const STEPS = [
  {id: "new", label: "Sent"},
  {id: "accepted", label: "Accepted"},
] as const;

export default async function OfferPage({params}: {params: Promise<{reference: string}>}) {
  const {reference} = await params;
  if (!OFFER_REFERENCE_PATTERN.test(reference)) notFound();

  const document = await createSanityServerClient()
    .getDocument<{_type?: string; status?: string; fabricName?: string; widthCm?: number; heightCm?: number}>(`submissions.${reference}`)
    .catch(() => null);
  const offer = buildOfferStatus(reference, document);
  if (!offer) notFound();

  return (
    <main id="main" className="mx-auto max-w-page px-6 pb-20 pt-16 sm:pt-20">
      <div className="mx-auto max-w-xl">
        <p className="font-mono text-[14px] text-muted">Offer {offer.reference}</p>
        <h1 className="mt-2 text-[clamp(32px,5vw,44px)] leading-[1.25] text-ink">{offer.title}</h1>
        <p className="mt-1 font-mono text-[14px] text-body">{offer.size}</p>

        <div role="status" className="mt-8 rounded-feature bg-paper p-6 shadow-lift">
          <h2 className="text-[28px] leading-[1.31] text-ink">{offer.headline}</h2>
          <p className="mt-2 text-[16px] leading-[1.63] text-body">{offer.detail}</p>
          {offer.stage !== "declined" && (
            <ol className="mt-5 flex gap-3 font-mono text-[13px]" aria-label="Progress">
              {STEPS.map((step, index) => {
                const done = offer.stage === "accepted" || index === 0;
                return (
                  <li key={step.id} className={`rounded-pill px-3 py-1 ${done ? "bg-ink text-paper" : "bg-recessed text-muted"}`}>
                    {step.label}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <p className="mt-6 text-[14px] leading-[1.71] text-body">
          Keep this page&apos;s address. It is the only way to check on your offer.{" "}
          <a href="/submit" className="text-ink underline underline-offset-[6px]">Offer another fabric</a>
        </p>
      </div>
    </main>
  );
}
