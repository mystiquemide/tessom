import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ErrorView } from "../../components/error-view";
import { NotFoundView } from "../../components/not-found-view";
import { OwnersSkeleton, OwnerSkeleton, PageSkeleton, RemnantSkeleton, ShopSkeleton } from "../../components/skeleton";

describe("NotFoundView", () => {
  it("says what happened and points back to the shop", () => {
    const html = renderToStaticMarkup(createElement(NotFoundView));
    expect(html).toContain("We can&#x27;t find that page.");
    expect(html).toContain("It may have been sold, or the link is wrong.");
    expect(html).toContain('href="/shop"');
  });
});

describe("ErrorView", () => {
  it("reassures, and offers a retry and a way out", () => {
    const html = renderToStaticMarkup(createElement(ErrorView, { reset: () => undefined }));
    expect(html).toContain("Something went wrong on our side.");
    expect(html).toContain("Nothing was ordered or changed by this error.");
    expect(html).toContain("Try again");
    expect(html).toContain('href="/shop"');
  });
});

describe("skeletons", () => {
  it("announce loading to screen readers and carry no data", () => {
    for (const [component, label] of [[ShopSkeleton, "Loading the shop"], [RemnantSkeleton, "Loading this piece"], [OwnersSkeleton, "Loading owners"], [OwnerSkeleton, "Loading this owner"], [PageSkeleton, "Loading"]] as const) {
      const html = renderToStaticMarkup(createElement(component));
      expect(html).toContain('role="status"');
      expect(html).toContain(`aria-label="${label}"`);
      expect(html).not.toMatch(/\$\d/);
    }
  });
});
