import type {FabricExtraction} from "../../lib/groq/fabric-extraction";

type FabricValue = {
  _type?: string;
  name?: string;
  maker?: string;
  valuePerM?: number;
};

type RepeatValue = {
  _type?: string;
  vCm?: number;
  hCm?: number;
};

export type RemnantExtractionValues = {
  fabric?: FabricValue;
  repeat?: RepeatValue;
  directional?: boolean;
};

export function hasApplicableSuggestion(extraction: FabricExtraction): boolean {
  return extraction.fabricName !== null ||
    extraction.maker !== null ||
    extraction.repeatVerticalCm !== null ||
    extraction.repeatHorizontalCm !== null ||
    extraction.directional !== null;
}

export function buildFabricExtractionUpdate(
  current: RemnantExtractionValues,
  extraction: FabricExtraction,
): RemnantExtractionValues {
  const update: RemnantExtractionValues = {};

  if (extraction.fabricName !== null || extraction.maker !== null) {
    update.fabric = {
      ...current.fabric,
      _type: "fabric",
      ...(extraction.fabricName === null ? {} : {name: extraction.fabricName}),
      ...(extraction.maker === null ? {} : {maker: extraction.maker}),
    };
  }

  if (extraction.repeatVerticalCm !== null || extraction.repeatHorizontalCm !== null) {
    update.repeat = {
      ...current.repeat,
      _type: "repeat",
      ...(extraction.repeatVerticalCm === null ? {} : {vCm: extraction.repeatVerticalCm}),
      ...(extraction.repeatHorizontalCm === null ? {} : {hCm: extraction.repeatHorizontalCm}),
    };
  }

  if (extraction.directional !== null) update.directional = extraction.directional;

  return update;
}
