import { describe, expect, it } from "vitest";

import { createPublicReadClient, fetchPhotoCredits } from "../../lib/sanity/public";

describe("fetchPhotoCredits", () => {
  it("lists each photographer once, sorted by name", async () => {
    const client = {
      fetch: async () => [
        { name: "Rick Rothenberg", url: "https://unsplash.com/photos/a" },
        { name: "Darrell Jonathan", url: "https://unsplash.com/photos/b" },
        { name: "Rick Rothenberg", url: "https://unsplash.com/photos/c" },
      ],
    };
    await expect(fetchPhotoCredits(client as never)).resolves.toEqual([
      { name: "Darrell Jonathan", url: "https://unsplash.com/photos/b" },
      { name: "Rick Rothenberg", url: "https://unsplash.com/photos/a" },
    ]);
  });

  it("returns no credits when the project is not configured or the read fails", async () => {
    await expect(fetchPhotoCredits(null)).resolves.toEqual([]);
    const failing = { fetch: async () => Promise.reject(new Error("offline")) };
    await expect(fetchPhotoCredits(failing as never)).resolves.toEqual([]);
  });

  it("builds no client without a project ID", () => {
    expect(createPublicReadClient({})).toBeNull();
  });
});
