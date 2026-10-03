import {NextResponse} from "next/server";
import {z} from "zod";

import {MAX_JSON_BODY_BYTES, readJsonBody} from "../../../../lib/http/json-body";
import {clientKey, createRateLimiter, tooManyRequests} from "../../../../lib/http/rate-limit";
import {SANITY_DOCUMENT_ID_PATTERN} from "../../../../lib/http/sanity-id";
import {verifyOwnerKey} from "../../../../lib/owners/link";
import {createSanityServerClient} from "../../../../lib/sanity/client";
import {advanceWorkflow} from "../../workflow/advance/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const NO_STORE = {"Cache-Control": "no-store"};

const bodySchema = z
  .object({
    ownerId: z.string().trim().regex(SANITY_DOCUMENT_ID_PATTERN),
    remnantId: z.string().trim().regex(SANITY_DOCUMENT_ID_PATTERN),
    decision: z.enum(["grant", "decline"]),
    key: z.string().trim().min(1).max(200),
  })
  .strict();

function respond(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {status, headers: NO_STORE});
}

/**
 * Lets an owner decide consent on their own pieces. The signed key replaces the workshop PIN,
 * and the decision runs through the same workflow code the workshop board uses.
 */
const decisions = createRateLimiter({limit: 20, windowMs: 10 * 60 * 1000});

export async function POST(request: Request): Promise<NextResponse> {
  const attempt = decisions.check(clientKey(request));
  if (!attempt.allowed) return tooManyRequests(attempt.retryAfterSec);
  let input: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await readJsonBody(request, MAX_JSON_BODY_BYTES));
    if (!parsed.success) return respond({error: "Invalid request"}, 400);
    input = parsed.data;
  } catch {
    return respond({error: "Invalid request"}, 400);
  }

  if (!verifyOwnerKey(input.ownerId, input.key)) return respond({error: "This link is not valid"}, 401);

  try {
    const remnant = await createSanityServerClient().fetch<{ownerId?: string; status?: string} | null>(
      `*[_type == "remnant" && _id == $id][0]{"ownerId": owner._ref, status}`,
      {id: input.remnantId},
    );
    if (!remnant || remnant.ownerId !== input.ownerId) return respond({error: "Piece not found"}, 404);
    if (remnant.status !== "intake" && remnant.status !== "consented") return respond({error: "This piece has already been decided"}, 409);

    await advanceWorkflow({action: input.decision, remnantId: input.remnantId});
    return respond({ok: true, decision: input.decision}, 200);
  } catch {
    return respond({error: "Couldn't save your decision. Try again."}, 500);
  }
}
