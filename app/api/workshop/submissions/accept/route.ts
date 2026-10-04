import {NextResponse} from "next/server";
import {z} from "zod";

import {MAX_JSON_BODY_BYTES, readJsonBody} from "../../../../../lib/http/json-body";
import {tooManyRequests} from "../../../../../lib/http/rate-limit";
import {createSanityServerClient} from "../../../../../lib/sanity/client";
import {decryptBuyerContact} from "../../../../../lib/sanity/orders";
import {
  buildAcceptDocuments,
  SUBMISSION_REVIEW_ID_PATTERN,
  type RawSubmission,
} from "../../../../../lib/submissions/review";
import {startConsentInstance} from "../../../../../lib/workflow";
import {checkWorkshopPin} from "../../../../../lib/workshop/auth";
import {pinAttemptsBlocked, recordPinFailure} from "../../../../../lib/workshop/pin-guard";
import {ownerLinkPath} from "../../../../../lib/owners/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const NO_STORE = {"Cache-Control": "no-store"};
const bodySchema = z
  .object({
    submissionId: z.string().trim().regex(SUBMISSION_REVIEW_ID_PATTERN),
    /** The workshop's own valuation per metre. The submitter never sets a price. */
    valuePerM: z.number().finite().positive().max(5000),
  })
  .strict();

function respond(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {status, headers: NO_STORE});
}

/**
 * Turns a reviewed offer into an owner and a remnant in intake, starts its consent workflow,
 * and hands the workshop the submitter's contact and the owner's private link. PIN only.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const waitSec = pinAttemptsBlocked(request);
  if (waitSec !== null) return tooManyRequests(waitSec);
  const check = checkWorkshopPin(request.headers);
  if (check === "unconfigured") return respond({error: "The board is unavailable right now"}, 503);
  if (check === "unauthorized") {
    recordPinFailure(request);
    return respond({error: "Unauthorized"}, 401);
  }

  let input: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await readJsonBody(request, MAX_JSON_BODY_BYTES));
    if (!parsed.success) return respond({error: "Invalid request"}, 400);
    input = parsed.data;
  } catch {
    return respond({error: "Invalid request"}, 400);
  }

  try {
    const client = createSanityServerClient();
    const submission = await client.getDocument<RawSubmission & {_type?: string; status?: string; _rev: string}>(input.submissionId);
    if (!submission || submission._type !== "submission") return respond({error: "Offer not found"}, 404);
    if (submission.status !== "new") return respond({error: "This offer was already handled"}, 409);

    const {ownerId, remnantId, owner, remnant} = buildAcceptDocuments(submission, input.valuePerM);
    const contact = decryptBuyerContact(submission.contact);

    await client
      .transaction()
      .createIfNotExists(owner as {_id: string; _type: string})
      .createIfNotExists(remnant as {_id: string; _type: string})
      .patch(input.submissionId, {set: {status: "accepted", remnantId, ownerId}, ifRevisionID: submission._rev})
      .commit();

    const started = await startConsentInstance(remnantId);
    if (!started) return respond({error: "Saved, but the consent workflow did not start. Run the workflow bootstrap."}, 502);

    return respond(
      {remnantId, ownerId, ownerLink: ownerLinkPath(ownerId), contact: {name: contact.buyerName, email: contact.buyerEmail}},
      200,
    );
  } catch {
    return respond({error: "Couldn't accept this offer. Try again."}, 500);
  }
}
