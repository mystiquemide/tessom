import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CutPlan, type CutPlanOffer } from "../../components/cut-plan";

const piece = { x: 0, y: 0, w: 30, h: 20, rotated: false, label: "Back", wCm: 27, hCm: 17 };
const offers: CutPlanOffer[] = [
  { id: "a", pieces: [piece] },
  { id: "b", pieces: [{ ...piece, label: "Front" }] },
];

function render(props: Partial<Parameters<typeof CutPlan>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(CutPlan, { widthCm: 140, heightCm: 90, photoUrl: "https://example.test/f.jpg", ariaLabel: "Fabric", ...props }),
  );
}

describe("CutPlan", () => {
  it("draws the photo and keeps the remnant's aspect ratio", () => {
    const html = render();
    expect(html).toContain('href="https://example.test/f.jpg"');
    expect(html).toContain("aspect-ratio:140 / 90");
    expect(html).toContain('aria-label="Fabric"');
  });

  it("shows no image when the remnant has no photo", () => {
    expect(render({ photoUrl: null })).not.toContain("<image");
  });

  it("labels pieces only for the active offer when several are drawn", () => {
    expect(render({ offers })).not.toContain("27×17");
    const active = render({ offers, activeOfferId: "a" });
    expect(active).toContain("Back 27×17");
    expect(active).not.toContain("Front 27×17");
  });

  it("labels the pieces of a single offer without being asked", () => {
    expect(render({ offers: [offers[0]] })).toContain("Back 27×17");
  });

  it("stamps sold areas once, on the largest one", () => {
    const html = render({ allocations: [{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 60, h: 40 }] });
    expect(html.match(/>Sold</g)).toHaveLength(1);
  });
});
