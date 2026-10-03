import Link from "next/link";

import {Logo} from "./logo";

const LINKS = [
  {href: "/#shop", label: "Shop"},
  {href: "/#how", label: "How it works"},
];

const linkClass = "text-ink underline-offset-[6px] decoration-1 hover:underline";

export function SiteNav() {
  return (
    <header className="border-b border-rule bg-canvas">
      <div className="mx-auto flex h-16 max-w-page items-center justify-between px-6">
        <Link href="/" aria-label="Tessom home">
          <Logo />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-8 sm:flex">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={linkClass}>
              {link.label}
            </Link>
          ))}
          <Link href="/#shop" className="rounded-pill bg-ink px-5 py-2 text-[16px] font-semibold text-paper">
            Browse pieces
          </Link>
        </nav>

        <details className="group relative sm:hidden">
          <summary className="flex h-10 cursor-pointer list-none items-center rounded-pill bg-ink px-4 text-[14px] font-semibold text-paper [&::-webkit-details-marker]:hidden">
            Menu
          </summary>
          <nav aria-label="Main" className="absolute right-0 top-12 z-10 flex w-56 flex-col rounded-card bg-paper p-2 shadow-card">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="rounded-card px-3 py-3 text-ink hover:bg-recessed">
                {link.label}
              </Link>
            ))}
          </nav>
        </details>
      </div>
    </header>
  );
}
