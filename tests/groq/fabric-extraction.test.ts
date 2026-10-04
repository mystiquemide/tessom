import {describe, expect, it, vi} from "vitest";

import {
  FabricExtractionError,
  extractFabricDetails,
  isAllowedSanityImageUrl,
} from "../../lib/groq/fabric-extraction";

const IMAGE_URL = "https://cdn.sanity.io/images/59g78icb/production/fabric-1600x1200.jpg";

function groqResponse(content: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({choices: [{message: {content: JSON.stringify(content)}}]}),
    {status, headers: {"content-type": "application/json"}},
  );
}

describe("isAllowedSanityImageUrl", () => {
  it("accepts only HTTPS images from this Sanity project and dataset", () => {
    const allowed = {projectId: "59g78icb", dataset: "production"};

    expect(isAllowedSanityImageUrl(IMAGE_URL, allowed)).toBe(true);
    expect(isAllowedSanityImageUrl(`${IMAGE_URL}?w=1800&fit=max`, allowed)).toBe(true);
    expect(isAllowedSanityImageUrl(IMAGE_URL.replace("https:", "http:"), allowed)).toBe(false);
    expect(isAllowedSanityImageUrl(IMAGE_URL.replace("59g78icb", "other"), allowed)).toBe(false);
    expect(isAllowedSanityImageUrl(IMAGE_URL.replace("production", "staging"), allowed)).toBe(false);
    expect(isAllowedSanityImageUrl("https://example.com/fabric.jpg", allowed)).toBe(false);
  });
});

describe("extractFabricDetails", () => {
  it("sends the image to Groq vision with a strict schema and returns validated suggestions", async () => {
    const implementation: (input: string, init?: RequestInit) => Promise<Response> = async () => groqResponse({
      fabricName: "Brera Lino",
      maker: "Designers Guild",
      repeatVerticalCm: 32,
      repeatHorizontalCm: 16,
      directional: true,
      confidence: "high",
      evidence: "The selvage states the maker, design name, and 32 x 16 cm repeat.",
    });
    const fetcher = vi.fn(implementation);

    await expect(extractFabricDetails(IMAGE_URL, {apiKey: "test-key", fetcher})).resolves.toEqual({
      fabricName: "Brera Lino",
      maker: "Designers Guild",
      repeatVerticalCm: 32,
      repeatHorizontalCm: 16,
      directional: true,
      confidence: "high",
      evidence: "The selvage states the maker, design name, and 32 x 16 cm repeat.",
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init?.headers).toMatchObject({Authorization: "Bearer test-key"});
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.model).toBe("qwen/qwen3.8-27b");
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {name: "fabric_selvage", strict: true},
    });
    expect(JSON.stringify(body)).toContain(IMAGE_URL);
  });

  it("keeps genuinely unknown values null instead of inventing fabric details", async () => {
    const fetcher = vi.fn(async () => groqResponse({
      fabricName: null,
      maker: null,
      repeatVerticalCm: null,
      repeatHorizontalCm: null,
      directional: null,
      confidence: "low",
      evidence: "No readable selvage or measurement is visible.",
    }));

    const result = await extractFabricDetails(IMAGE_URL, {apiKey: "test-key", fetcher});

    expect(result.fabricName).toBeNull();
    expect(result.repeatVerticalCm).toBeNull();
    expect(result.confidence).toBe("low");
  });

  it("fails closed when the API key is missing", async () => {
    const fetcher = vi.fn();

    await expect(extractFabricDetails(IMAGE_URL, {apiKey: "", fetcher})).rejects.toMatchObject({
      kind: "configuration",
    } satisfies Partial<FabricExtractionError>);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("turns Groq failures and invalid model output into safe typed errors", async () => {
    const failed = vi.fn(async () => new Response("busy", {status: 503}));
    await expect(extractFabricDetails(IMAGE_URL, {apiKey: "test-key", fetcher: failed})).rejects.toMatchObject({
      kind: "upstream",
    } satisfies Partial<FabricExtractionError>);

    const invalid = vi.fn(async () => groqResponse({fabricName: "Only one field"}));
    await expect(extractFabricDetails(IMAGE_URL, {apiKey: "test-key", fetcher: invalid})).rejects.toMatchObject({
      kind: "invalid-response",
    } satisfies Partial<FabricExtractionError>);
  });
});
