import type {Metadata} from "next";

import {SubmitForm} from "../../../components/submit-form";

export const metadata: Metadata = {
  title: "Offer your fabric | Tessom",
  description: "Send us the size and a photo of leftover upholstery fabric. The workshop reviews it before anything is listed.",
};

export default function SubmitPage() {
  return (
    <main id="main" className="mx-auto max-w-page px-6 pb-20 pt-16 sm:pt-20">
      <div className="relative mx-auto max-w-xl">
        <h1 className="text-[clamp(32px,5vw,44px)] leading-[1.25] text-ink">Offer your fabric</h1>
        <p className="mt-3 text-[16px] leading-[1.63] text-body">
          Got upholstery fabric left over? Tell us the size and send a photo. The workshop checks it, you approve it, and then it can be cut into one-off pieces.
        </p>
        <div className="mt-8">
          <SubmitForm />
        </div>
      </div>
    </main>
  );
}
