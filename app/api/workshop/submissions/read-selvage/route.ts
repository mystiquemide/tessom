import {NextResponse} from "next/server";
import {z} from "zod";

import {FabricExtractionError, extractFabricDetails, isAllowedSanityImageUrl} from "../../../../../lib/groq/fabric-extraction";
import {MAX_JSON_BODY_BYTES, readJsonBody} from "../../../../../lib/http/json-body";
import {clientKey, createRateLimiter, tooManyRequests} from "../../../../../lib/http/rate-limit";
import {createSanityServerClient} from "../../../../../lib/sanity/client";
import {sanityImageUrl} from "../../../../../lib/sanity/image";
import {SUBMISSION_REVIEW_ID_PATTERN, type RawSubmission} from "../../../../../lib/submissions/review";
import {checkWorkshopPin} from "../../../../../lib/workshop/auth";
import {pinAttemptsBlocked, recordPinFailure} from "../../../../../lib/workshop/pin-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const NO_STORE = {"Cache-Control": "no-store"};
const readRequests = createRateLimiter({limit: 12, windowMs: 10 * 60 * 1000});
const bodySchema = z.object({submissionId: z.string().trim().regex(SUBMISSION_REVIEW_ID_PATTERN)}).strict();

function respond(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {status, headers: NO_STORE});
}

/**
 * Reads the printed selvage on an offered fabric's photo and returns suggestions with their evidence.
 * It changes nothing. The workshop reviews the suggestions and sends them back with Accept. PIN only.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const waitSec = pinAttemptsBlocked(request);
  if (waitSec !== null) return tooManyRequests(waitSec);
  const check = checkWorkshopPin(request.headers);
  if (check === "unconfigured") return respond({error: "Fabric reading is unavailable right now"}, 503);
  if (check === "unauthorized") {
    recordPinFailure(request);
    return respond({error: "Unauthorized"}, 401);
  }
  const rate = readRequests.check(clientKey(request));
  if (!rate.allowed) return tooManyRequests(rate.retryAfterSec);

  let submissionId: string;
  try {
    const parsed = bodySchema.safeParse(await readJsonBody(request, MAX_JSON_BODY_BYTES));
    if (!parsed.success) return respond({error: "Invalid request"}, 400);
    submissionId = parsed.data.submissionId;
  } catch {
    return respond({error: "Invalid request"}, 400);
  }

  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID?.trim();
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET?.trim();
  if (!projectId || !dataset) return respond({error: "Fabric reading is unavailable right now"}, 503);

  try {
    const submission = await createSanityServerClient().getDocument<RawSubmission & {_type?: string; status?: string}>(submissionId);
    if (!submission || submission._type !== "submission") return respond({error: "Offer not found"}, 404);
    if (submission.status !== "new") return respond({error: "This offer was already handled"}, 409);
    const imageUrl = sanityImageUrl(submission.photo, 1600);
    if (!imageUrl || !isAllowedSanityImageUrl(imageUrl, {projectId, dataset})) return respond({error: "This offer has no readable photo"}, 422);
    return respond(await extractFabricDetails(imageUrl), 200);
  } catch (error) {
    if (error instanceof FabricExtractionError && error.kind === "configuration") return respond({error: "Fabric reading is unavailable right now"}, 503);
    return respond({error: "Unable to read this photo right now"}, 502);
  }
}
