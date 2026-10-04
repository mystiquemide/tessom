import {describe, expect, it} from "vitest";

import {
  ReadSelvagePhotoAction,
  resolveFabricExtractionActions,
} from "../../sanity/fabric-extraction/action";

describe("resolveFabricExtractionActions", () => {
  const builtIn = (() => ({label: "Publish", onHandle() {}})) as never;

  it("adds the extraction action only to remnant documents", () => {
    expect(resolveFabricExtractionActions([builtIn], {schemaType: "remnant"} as never)).toEqual([
      builtIn,
      ReadSelvagePhotoAction,
    ]);
    expect(resolveFabricExtractionActions([builtIn], {schemaType: "owner"} as never)).toEqual([builtIn]);
  });
});
