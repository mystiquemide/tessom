import {NextResponse} from "next/server";
import {z} from "zod";

import {MAX_JSON_BODY_BYTES, readJsonBody} from "../../../../../lib/http/json-body";
import {tooManyRequests} from "../../../../../lib/http/rate-limit";
import {createSanityServerClient} from "../../../../../lib/sanity/client";
import {SUBMISSION_REVIEW_ID_PATTERN} from "../../../../../lib/submissions/review";
import {checkWorkshopPin} from "../../../../../lib/workshop/auth";
import {pinAttemptsBlocked, recordPinFailure} from "../../../../../lib/workshop/pin-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const NO_STORE = {"Cache-Control": "no-store"};
const bodySchema = z.object({submissionId: z.string().trim().regex(SUBMISSION_REVIEW_ID_PATTERN)}).strict();

function respond(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {status, headers: NO_STORE});
}

/** Closes a fabric offer the workshop won't take. Nothing is deleted. PIN only. */
export async function POST(request: Request): Promise<NextResponse> {
  const waitSec = pinAttemptsBlocked(request);
  if (waitSec !== null) return tooManyRequests(waitSec);
  const check = checkWorkshopPin(request.headers);
  if (check === "unconfigured") return respond({error: "The board is unavailable right now"}, 503);
  if (check === "unauthorized") {
    recordPinFailure(request);
    return respond({error: "Unauthorized"}, 401);
  }

  let submissionId: string;
  try {
    const parsed = bodySchema.safeParse(await readJsonBody(request, MAX_JSON_BODY_BYTES));
    if (!parsed.success) return respond({error: "Invalid request"}, 400);
    submissionId = parsed.data.submissionId;
  } catch {
    return respond({error: "Invalid request"}, 400);
  }

  try {
    const client = createSanityServerClient();
    const submission = await client.getDocument<{_type?: string; status?: string; _rev: string}>(submissionId);
    if (!submission || submission._type !== "submission") return respond({error: "Offer not found"}, 404);
    if (submission.status !== "new") return respond({error: "This offer was already handled"}, 409);
    await client.patch(submissionId).set({status: "declined"}).ifRevisionId(submission._rev).commit();
    return respond({status: "declined"}, 200);
  } catch {
    return respond({error: "Couldn't decline this offer. Try again."}, 500);
  }
}
