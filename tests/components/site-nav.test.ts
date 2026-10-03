import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let path = "/";
vi.mock("next/navigation", () => ({ usePathname: () => path }));

import { isCurrent, SiteNav } from "../../components/site-nav";

const desktopLinks = (html: string): string[] => {
  const nav = html.slice(html.indexOf('aria-label="Main"'), html.indexOf("</nav>"));
  return [...nav.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((match) => match[1]);
};

describe("isCurrent", () => {
  it("matches the page itself and pages inside it only", () => {
    expect(isCurrent("/owner", "/owner")).toBe(true);
    expect(isCurrent("/owner/clara", "/owner")).toBe(true);
    expect(isCurrent("/owners", "/owner")).toBe(false);
    expect(isCurrent("/", "/owner")).toBe(false);
  });
});

describe("SiteNav", () => {
  beforeEach(() => {
    path = "/";
  });

  it("shows every link on the landing page", () => {
    expect(desktopLinks(renderToStaticMarkup(createElement(SiteNav)))).toEqual(["Workshop", "Owners", "Browse pieces"]);
  });

  it("drops the Workshop link on the workshop page", () => {
    path = "/workshop";
    const html = renderToStaticMarkup(createElement(SiteNav));
    expect(desktopLinks(html)).toEqual(["Owners", "Browse pieces"]);
    expect(html).not.toContain(">Workshop<");
  });

  it("drops Owners on the owner pages and the shop pill on the shop", () => {
    path = "/owner/clara";
    expect(desktopLinks(renderToStaticMarkup(createElement(SiteNav)))).toEqual(["Workshop", "Browse pieces"]);
    path = "/shop";
    expect(desktopLinks(renderToStaticMarkup(createElement(SiteNav)))).toEqual(["Workshop", "Owners"]);
  });

  it("keeps the logo and skip link everywhere", () => {
    path = "/workshop";
    const html = renderToStaticMarkup(createElement(SiteNav));
    expect(html).toContain('aria-label="Tessom home"');
    expect(html).toContain("Skip to content");
  });
});
