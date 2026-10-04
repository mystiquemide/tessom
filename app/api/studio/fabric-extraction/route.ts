import {NextResponse} from "next/server";
import {z} from "zod";

import {FabricExtractionError, extractFabricDetails, isAllowedSanityImageUrl} from "../../../../lib/groq/fabric-extraction";
import {readJsonBody} from "../../../../lib/http/json-body";
import {clientKey, createRateLimiter, tooManyRequests} from "../../../../lib/http/rate-limit";
import {checkWorkshopPin} from "../../../../lib/workshop/auth";
import {pinAttemptsBlocked, recordPinFailure} from "../../../../lib/workshop/pin-guard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const NO_STORE = {"Cache-Control": "no-store"};
const MAX_EXTRACTION_BODY_BYTES = 4 * 1024;
const extractionRequests = createRateLimiter({limit: 12, windowMs: 10 * 60 * 1_000});
const requestSchema = z.object({imageUrl: z.string().trim().min(1).max(2_048)}).strict();

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {status, headers: NO_STORE});
}

export async function POST(request: Request): Promise<NextResponse> {
  const pinWait = pinAttemptsBlocked(request);
  if (pinWait !== null) return tooManyRequests(pinWait);

  const pin = checkWorkshopPin(request.headers);
  if (pin === "unconfigured") return json({error: "Fabric extraction is unavailable right now"}, 503);
  if (pin === "unauthorized") {
    recordPinFailure(request);
    return json({error: "Unauthorized"}, 401);
  }

  const rate = extractionRequests.check(clientKey(request));
  if (!rate.allowed) return tooManyRequests(rate.retryAfterSec);

  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await readJsonBody(request, MAX_EXTRACTION_BODY_BYTES));
  } catch {
    return json({error: "Invalid extraction request"}, 400);
  }

  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID?.trim();
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET?.trim();
  if (!projectId || !dataset) return json({error: "Fabric extraction is unavailable right now"}, 503);
  if (!isAllowedSanityImageUrl(input.imageUrl, {projectId, dataset})) {
    return json({error: "Invalid extraction request"}, 400);
  }

  try {
    return json(await extractFabricDetails(input.imageUrl));
  } catch (error) {
    if (error instanceof FabricExtractionError) {
      if (error.kind === "configuration") {
        return json({error: "Fabric extraction is unavailable right now"}, 503);
      }
      return json({error: "Unable to read this fabric photo right now"}, 502);
    }
    return json({error: "Unable to read this fabric photo right now"}, 500);
  }
}
