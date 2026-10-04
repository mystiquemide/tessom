import {z} from "zod";

export const GROQ_VISION_MODEL = "qwen/qwen3.8-27b";
const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 12_000;

const fabricExtractionSchema = z.object({
  fabricName: z.string().trim().min(1).max(160).nullable(),
  maker: z.string().trim().min(1).max(160).nullable(),
  repeatVerticalCm: z.number().positive().max(1_000).nullable(),
  repeatHorizontalCm: z.number().positive().max(1_000).nullable(),
  directional: z.boolean().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  evidence: z.string().trim().min(1).max(500),
}).strict();

export type FabricExtraction = z.infer<typeof fabricExtractionSchema>;
export type FabricExtractionErrorKind = "configuration" | "upstream" | "invalid-response";

export class FabricExtractionError extends Error {
  readonly kind: FabricExtractionErrorKind;

  constructor(kind: FabricExtractionErrorKind, cause?: unknown) {
    const message = kind === "configuration"
      ? "Fabric extraction is not configured"
      : kind === "upstream"
        ? "The fabric extraction service is unavailable"
        : "The fabric extraction service returned invalid data";
    super(message, {cause});
    this.name = "FabricExtractionError";
    this.kind = kind;
  }
}

type AllowedSanityImage = {
  projectId: string;
  dataset: string;
};

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

type ExtractFabricOptions = {
  apiKey?: string;
  fetcher?: Fetcher;
  signal?: AbortSignal;
};

export function isAllowedSanityImageUrl(value: unknown, allowed: AllowedSanityImage): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) return false;
  if (!/^[a-z0-9-]+$/i.test(allowed.projectId) || !/^[a-z0-9_-]+$/i.test(allowed.dataset)) return false;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "cdn.sanity.io" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    ) {
      return false;
    }
    return url.pathname.startsWith(`/images/${allowed.projectId}/${allowed.dataset}/`) &&
      url.pathname.length > `/images/${allowed.projectId}/${allowed.dataset}/`.length;
  } catch {
    return false;
  }
}

const responseJsonSchema = {
  type: "object",
  properties: {
    fabricName: {type: ["string", "null"]},
    maker: {type: ["string", "null"]},
    repeatVerticalCm: {type: ["number", "null"]},
    repeatHorizontalCm: {type: ["number", "null"]},
    directional: {type: ["boolean", "null"]},
    confidence: {type: "string", enum: ["low", "medium", "high"]},
    evidence: {type: "string"},
  },
  required: [
    "fabricName",
    "maker",
    "repeatVerticalCm",
    "repeatHorizontalCm",
    "directional",
    "confidence",
    "evidence",
  ],
  additionalProperties: false,
} as const;

const EXTRACTION_PROMPT = [
  "Read the printed selvage information in this upholstery fabric photo.",
  "Extract the fabric or design name, maker, stated vertical and horizontal repeat in centimetres, and whether the fabric is directional.",
  "Use only text, measurements, arrows, or explicit markings visible in the image.",
  "Do not estimate repeat dimensions from the motif and do not infer a maker from visual style.",
  "Return null for every value that is not clearly supported by the image.",
  "Evidence must be one short sentence describing the visible basis for the result.",
].join(" ");

function requestBody(imageUrl: string): string {
  return JSON.stringify({
    model: GROQ_VISION_MODEL,
    messages: [{
      role: "user",
      content: [
        {type: "text", text: EXTRACTION_PROMPT},
        {type: "image_url", image_url: {url: imageUrl}},
      ],
    }],
    reasoning_effort: "low",
    max_completion_tokens: 600,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "fabric_selvage",
        strict: true,
        schema: responseJsonSchema,
      },
    },
  });
}

export async function extractFabricDetails(
  imageUrl: string,
  options: ExtractFabricOptions = {},
): Promise<FabricExtraction> {
  const apiKey = options.apiKey?.trim() || process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new FabricExtractionError("configuration");

  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(GROQ_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: requestBody(imageUrl),
      signal: options.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw new FabricExtractionError("upstream", error);
  }

  if (!response.ok) throw new FabricExtractionError("upstream");

  try {
    const envelope = await response.json() as {
      choices?: Array<{message?: {content?: unknown}}>;
    };
    const content = envelope.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Missing completion content");
    return fabricExtractionSchema.parse(JSON.parse(content));
  } catch (error) {
    throw new FabricExtractionError("invalid-response", error);
  }
}
