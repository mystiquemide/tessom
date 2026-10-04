import {describe, expect, it} from "vitest";

import type {FabricExtraction} from "../../lib/groq/fabric-extraction";
import {buildFabricExtractionUpdate, hasApplicableSuggestion} from "../../sanity/fabric-extraction/update";

const extraction: FabricExtraction = {
  fabricName: "Brera Lino",
  maker: "Designers Guild",
  repeatVerticalCm: 32,
  repeatHorizontalCm: 16,
  directional: true,
  confidence: "high",
  evidence: "The selvage provides every value.",
};

describe("buildFabricExtractionUpdate", () => {
  it("applies suggestions without dropping workshop-entered fabric values", () => {
    const update = buildFabricExtractionUpdate({
      fabric: {_type: "fabric", name: "Old name", maker: "Old maker", valuePerM: 120},
      repeat: {_type: "repeat", vCm: 12, hCm: 6},
      directional: false,
    }, extraction);

    expect(update).toEqual({
      fabric: {_type: "fabric", name: "Brera Lino", maker: "Designers Guild", valuePerM: 120},
      repeat: {_type: "repeat", vCm: 32, hCm: 16},
      directional: true,
    });
  });

  it("never overwrites existing fields with uncertain null suggestions", () => {
    const update = buildFabricExtractionUpdate({
      fabric: {_type: "fabric", name: "Keep name", maker: "Keep maker", valuePerM: 90},
      repeat: {_type: "repeat", vCm: 20, hCm: 10},
      directional: false,
    }, {...extraction, fabricName: null, repeatHorizontalCm: null, directional: null});

    expect(update.fabric).toEqual({_type: "fabric", name: "Keep name", maker: "Designers Guild", valuePerM: 90});
    expect(update.repeat).toEqual({_type: "repeat", vCm: 32, hCm: 10});
    expect(update).not.toHaveProperty("directional");
  });

  it("returns no changes when the photo contains no supported details", () => {
    const unknown: FabricExtraction = {
      fabricName: null,
      maker: null,
      repeatVerticalCm: null,
      repeatHorizontalCm: null,
      directional: null,
      confidence: "low",
      evidence: "No readable selvage is visible.",
    };

    expect(buildFabricExtractionUpdate({}, unknown)).toEqual({});
    expect(hasApplicableSuggestion(unknown)).toBe(false);
    expect(hasApplicableSuggestion(extraction)).toBe(true);
  });
});
