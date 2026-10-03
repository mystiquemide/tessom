import Link from "next/link";

import {Logo} from "./logo";

import {fetchPhotoCredits} from "../lib/sanity/public";

export async function SiteFooter() {
  const credits = await fetchPhotoCredits();

  return (
    <footer className="mt-20 border-t border-rule bg-recessed">
      <div className="mx-auto max-w-page px-6 py-12">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-3 text-[14px] leading-[1.71] text-body">
              Every offcut has a next piece. Leftover upholstery fabric, cut into one-off cushions, pads and totes.
            </p>
          </div>
          <nav aria-label="Footer" className="flex gap-6 text-[14px]">
            <Link href="/#shop" className="text-ink underline-offset-[6px] hover:underline">
              Shop
            </Link>
            <Link href="/#how" className="text-ink underline-offset-[6px] hover:underline">
              How it works
            </Link>
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
