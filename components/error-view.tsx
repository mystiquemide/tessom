"use client";

import Link from "next/link";

export function ErrorView({reset}: {reset: () => void}) {
  return (
    <main className="mx-auto max-w-page px-6 pb-20 pt-24 text-center">
      <h1 className="mx-auto max-w-2xl text-[clamp(32px,5vw,44px)] leading-[1.25] text-ink">Something went wrong on our side.</h1>
      <p className="mx-auto mt-3 max-w-[560px] text-[16px] leading-[1.63] text-body">Nothing was ordered or changed.</p>
      <div className="mt-8 flex items-center justify-center gap-4">
        <button type="button" onClick={reset} className="rounded-pill bg-ink px-5 py-2 text-[16px] font-semibold text-paper">
          Try again
        </button>
        <Link href="/shop" className="text-[16px] text-ink underline-offset-[6px] hover:underline">
          Back to the shop
        </Link>
      </div>
    </main>
  );
}
