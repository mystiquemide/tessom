import type {ShopRemnant} from "../lib/shop";
import {CutPlan} from "./cut-plan";

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

function plan(remnant: ShopRemnant, withOffers: boolean) {
  const first = remnant.offers[0];
  return (
    <CutPlan
      widthCm={remnant.widthCm}
      heightCm={remnant.heightCm}
      photoUrl={remnant.photoUrl}
      ariaLabel={`${remnant.title}, ${remnant.widthCm} by ${remnant.heightCm} centimetres`}
      defects={remnant.defects}
      offers={withOffers ? remnant.offers : []}
      activeOfferId={withOffers && first ? first.id : null}
      className="border border-charcoal/60"
    />
  );
}

export function HowItWorks({remnants}: {remnants: readonly ShopRemnant[]}) {
  const [logged, consented, cut] = [remnants[0], remnants[1] ?? remnants[0], remnants[2] ?? remnants[0]];

  const steps = [
    {
      title: "Logged",
      text: "The workshop measures every offcut: size, pattern repeat, nap direction and flaws. Then it goes in with a photo.",
      visual: logged && (
        <div className="relative">
          {plan(logged, false)}
          <span className="absolute bottom-3 left-3 rounded-pill bg-paper px-3 py-1 font-mono text-[14px] leading-[1.71] text-ink shadow-hairline">
            {logged.widthCm} × {logged.heightCm} cm
          </span>
        </div>
      ),
    },
    {
      title: "Consented",
      text: "The fabric's owner says yes before anything is listed. Client leftovers stay with the client until they agree.",
      visual: consented && (
        <div className="relative">
          {plan(consented, false)}
          <div className="absolute bottom-3 left-3">
            <ConsentPill />
          </div>
        </div>
      ),
    },
    {
      title: "Cut",
      text: "Every piece is planned to the centimetre. Order one and those pieces are locked, then the workshop cuts, sews and ships.",
      visual: cut && plan(cut, true),
    },
  ];

  return (
    <section id="how" className="mx-auto max-w-page px-6 pt-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-[clamp(28px,4.4vw,36px)] leading-[1.31] text-ink">From leftover to ordered, in three steps.</h2>
      </div>
      <ol className="mt-12 grid gap-12 md:grid-cols-3 md:gap-8">
        {steps.map((step, index) => (
          <li key={step.title}>
            {step.visual && (
              <div className="flex items-center rounded-feature bg-paper p-5 shadow-card md:h-[290px]">
                <div className="w-full">{step.visual}</div>
              </div>
            )}
            <div className="mt-6 flex items-baseline gap-3">
              <span className="font-serif text-[28px] leading-[1.31] text-muted">{index + 1}.</span>
              <h3 className="font-serif text-[28px] leading-[1.31] text-ink">{step.title}</h3>
            </div>
            <p className="mt-2 text-[16px] leading-[1.63] text-body">{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
