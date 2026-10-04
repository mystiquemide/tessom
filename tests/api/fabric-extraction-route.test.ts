import {beforeEach, describe, expect, it, vi} from "vitest";

import {POST} from "../../app/api/studio/fabric-extraction/route";
import {FabricExtractionError, extractFabricDetails} from "../../lib/groq/fabric-extraction";

vi.mock("../../lib/groq/fabric-extraction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/groq/fabric-extraction")>()),
  extractFabricDetails: vi.fn(),
}));

const PIN = "a-long-workshop-pin-123";
const IMAGE_URL = "https://cdn.sanity.io/images/59g78icb/production/fabric-1600x1200.jpg";
const mockedExtract = vi.mocked(extractFabricDetails);

function call(body: unknown, pin = PIN, contentType = "application/json") {
  return POST(new Request("http://x/api/studio/fabric-extraction", {
    method: "POST",
    headers: {
      "content-type": contentType,
      ...(pin ? {"x-workshop-pin": pin} : {}),
    },
    body: JSON.stringify(body),
  }));
}

describe("POST /api/studio/fabric-extraction", () => {
  beforeEach(() => {
    process.env.WORKSHOP_PIN = PIN;
    process.env.NEXT_PUBLIC_SANITY_PROJECT_ID = "59g78icb";
    process.env.NEXT_PUBLIC_SANITY_DATASET = "production";
    mockedExtract.mockReset().mockResolvedValue({
      fabricName: "Brera Lino",
      maker: "Designers Guild",
      repeatVerticalCm: 32,
      repeatHorizontalCm: 16,
      directional: true,
      confidence: "high",
      evidence: "The printed selvage provides each value.",
    });
  });

  it("requires the configured workshop PIN", async () => {
    expect((await call({imageUrl: IMAGE_URL}, "")).status).toBe(401);
    expect((await call({imageUrl: IMAGE_URL}, "wrong-wrong-wrong")).status).toBe(401);

    process.env.WORKSHOP_PIN = "short";
    expect((await call({imageUrl: IMAGE_URL}, "short")).status).toBe(503);
    expect(mockedExtract).not.toHaveBeenCalled();
  });

  it("accepts only bounded JSON with an image from the configured Sanity dataset", async () => {
    expect((await call({imageUrl: IMAGE_URL}, PIN, "text/plain")).status).toBe(400);
    expect((await call({imageUrl: "https://example.com/fabric.jpg"})).status).toBe(400);
    expect((await call({imageUrl: IMAGE_URL.replace("production", "staging")})).status).toBe(400);
    expect((await call({imageUrl: IMAGE_URL, extra: true})).status).toBe(400);
    expect(mockedExtract).not.toHaveBeenCalled();
  });

  it("returns uncached, validated extraction suggestions", async () => {
    const response = await call({imageUrl: IMAGE_URL});

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mockedExtract).toHaveBeenCalledWith(IMAGE_URL);
    await expect(response.json()).resolves.toMatchObject({
      fabricName: "Brera Lino",
      repeatVerticalCm: 32,
      confidence: "high",
    });
  });

  it("uses safe status codes when configuration or Groq fails", async () => {
    mockedExtract.mockRejectedValueOnce(new FabricExtractionError("configuration"));
    expect((await call({imageUrl: IMAGE_URL})).status).toBe(503);

    mockedExtract.mockRejectedValueOnce(new FabricExtractionError("upstream"));
    expect((await call({imageUrl: IMAGE_URL})).status).toBe(502);

    mockedExtract.mockRejectedValueOnce(new FabricExtractionError("invalid-response"));
    expect((await call({imageUrl: IMAGE_URL})).status).toBe(502);
  });
});
