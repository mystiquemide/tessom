"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";

import {Logo} from "./logo";

const LINKS = [
  {href: "/workshop", label: "Workshop"},
  {href: "/owner", label: "Owners"},
];

const SHOP_HREF = "/shop";

const linkClass = "text-ink underline-offset-[6px] decoration-1 hover:underline";

/** True when the page is this destination or one inside it. */
export function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteNav() {
  const pathname = usePathname() ?? "/";
  const links = LINKS.filter((link) => !isCurrent(pathname, link.href));
  const showShop = !isCurrent(pathname, SHOP_HREF);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-20 focus:rounded-pill focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Skip to content
      </a>
      <header className="border-b border-rule bg-canvas">
        <div className="mx-auto flex h-16 max-w-page items-center justify-between px-6">
          <Link href="/" aria-label="Tessom home">
            <Logo />
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-8 sm:flex">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className={linkClass}>
                {link.label}
              </Link>
            ))}
            {showShop && (
              <Link href={SHOP_HREF} className="rounded-pill bg-ink px-5 py-2 text-[16px] font-semibold text-paper">
                Browse pieces
              </Link>
            )}
          </nav>

          {(links.length > 0 || showShop) && (
            <details className="group relative sm:hidden">
              <summary className="flex h-10 cursor-pointer list-none items-center rounded-pill bg-ink px-4 text-[14px] font-semibold text-paper [&::-webkit-details-marker]:hidden">
                Menu
              </summary>
              <nav aria-label="Main" className="absolute right-0 top-12 z-10 flex w-56 flex-col rounded-card bg-paper p-2 shadow-card">
                {links.map((link) => (
                  <Link key={link.href} href={link.href} className="rounded-card px-3 py-3 text-ink hover:bg-recessed">
                    {link.label}
                  </Link>
                ))}
                {showShop && (
                  <Link href={SHOP_HREF} className="rounded-card px-3 py-3 text-ink hover:bg-recessed">
                    Browse pieces
                  </Link>
                )}
              </nav>
            </details>
          )}
        </div>
      </header>
    </>
  );
}
