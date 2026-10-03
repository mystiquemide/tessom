import Link from "next/link";

export function ClosingCta() {
  return (
    <section className="mx-auto max-w-page px-6 pt-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-[clamp(28px,4.4vw,36px)] leading-[1.31] text-ink">Find the piece that has been waiting.</h2>
        <p className="mx-auto mt-3 max-w-[560px] text-[16px] leading-[1.63] text-body">
          Premium fabric, cut once, for one buyer. When a piece is gone, it is gone.
        </p>
        <Link href="/#shop" className="mt-8 inline-flex items-center gap-2 rounded-pill bg-ink px-5 py-2 text-[16px] font-semibold text-paper">
          Browse pieces
          <span aria-hidden="true" className="opacity-60">
            →
          </span>
        </Link>
      </div>
    </section>
  );
}
