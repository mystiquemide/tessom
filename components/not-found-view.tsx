import Link from "next/link";

export function NotFoundView() {
  return (
    <main id="main" className="mx-auto max-w-page px-6 pb-20 pt-24 text-center">
      <p className="font-mono text-[14px] uppercase tracking-wide text-muted">404</p>
      <h1 className="mx-auto mt-3 max-w-2xl text-[clamp(32px,5vw,44px)] leading-[1.25] text-ink">We can&apos;t find that page.</h1>
      <p className="mx-auto mt-3 max-w-[560px] text-[16px] leading-[1.63] text-body">It may have been sold, or the link is wrong.</p>
      <Link href="/shop" className="mt-8 inline-flex items-center gap-2 rounded-pill bg-ink px-5 py-2.5 text-[16px] font-semibold text-paper">
        Browse pieces
        <span aria-hidden="true" className="opacity-60">
          →
        </span>
      </Link>
    </main>
  );
}
