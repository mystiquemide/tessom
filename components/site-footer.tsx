import Link from "next/link";

import {availableKinds, fetchShopRemnants, KIND_LABELS} from "../lib/shop";
import {fetchPhotoCredits} from "../lib/sanity/public";
import {Logo} from "./logo";

const linkClass = "text-ink underline-offset-[6px] hover:underline";

export async function SiteFooter() {
  const [credits, remnants] = await Promise.all([fetchPhotoCredits(), fetchShopRemnants()]);
  const kinds = availableKinds(remnants);

  return (
    <footer className="mt-20 border-t border-rule bg-recessed">
      <div className="mx-auto max-w-page px-6 py-12">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-3 text-[14px] leading-[1.71] text-body">
              Every offcut has a next piece. Leftover upholstery fabric, cut into one-off cushions, pads and totes.
            </p>
          </div>

          {kinds.length > 0 && (
            <nav aria-label="Shop by item">
              <p className="font-mono text-[12px] uppercase tracking-wide text-muted">Shop</p>
              <ul className="mt-3 space-y-2 text-[14px]">
                {kinds.map((entry) => (
                  <li key={entry.kind}>
                    <Link href={`/?kind=${entry.kind}#shop`} className={linkClass}>
                      {KIND_LABELS[entry.kind]}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <nav aria-label="About">
            <p className="font-mono text-[12px] uppercase tracking-wide text-muted">How it works</p>
            <ul className="mt-3 space-y-2 text-[14px]">
              <li>
                <Link href="/#how" className={linkClass}>
                  Logged, consented, cut
                </Link>
              </li>
              <li>
                <Link href="/#shop" className={linkClass}>
                  On the table now
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Workshop">
            <p className="font-mono text-[12px] uppercase tracking-wide text-muted">Workshop</p>
            <ul className="mt-3 space-y-2 text-[14px]">
              <li>
                <Link href="/studio" className={linkClass}>
                  Log an offcut in Studio
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        {credits.length > 0 && (
          <div className="mt-10 border-t border-rule pt-6">
            <p className="font-mono text-[12px] uppercase tracking-wide text-muted">Photography on Unsplash</p>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] leading-[1.5] text-body">
              {credits.map((credit) => (
                <li key={credit.url}>
                  <a href={credit.url} rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                    {credit.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </footer>
  );
}
