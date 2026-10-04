import {NextResponse} from "next/server";

import {clientKey, createRateLimiter, tooManyRequests} from "../../../lib/http/rate-limit";
import {createSanityServerClient} from "../../../lib/sanity/client";
import {encryptBuyerContact} from "../../../lib/sanity/orders";
import {
  buildSubmissionDocument,
  detectPhotoType,
  MAX_FORM_BYTES,
  MAX_PHOTO_BYTES,
  newSubmissionId,
  publicSubmissionReference,
  submissionFieldsSchema,
} from "../../../lib/submissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const NO_STORE = {"Cache-Control": "no-store"};
/** Three fabrics per hour from one address. A speed bump, not a guarantee. */
const limiter = createRateLimiter({limit: 3, windowMs: 60 * 60 * 1000});

function respond(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {status, headers: NO_STORE});
}

/** Public. Stores a fabric offer on a private path for the workshop to review. It never lists anything. */
export async function POST(request: Request): Promise<NextResponse> {
  const length = request.headers.get("content-length");
  if (length === null || !/^\d+$/.test(length)) return respond({error: "Send the form with a photo"}, 411);
  if (Number(length) > MAX_FORM_BYTES) return respond({error: "That photo is too large. Keep it under 3 MB"}, 413);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    return respond({error: "Invalid request"}, 400);
  }

  const verdict = limiter.check(clientKey(request));
  if (!verdict.allowed) return tooManyRequests(verdict.retryAfterSec);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return respond({error: "Invalid request"}, 400);
  }

  const raw: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") raw[key] = value;
  }
  const parsed = submissionFieldsSchema.safeParse(raw);
  if (!parsed.success) return respond({error: "Check the form and try again"}, 400);
  const fields = parsed.data;
  // A filled honeypot gets a normal-looking answer so a script learns nothing.
  if (fields.website !== "") return respond({reference: "0000000000000000"}, 201);

  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return respond({error: "Add a photo of the fabric"}, 400);
  if (file.size > MAX_PHOTO_BYTES) return respond({error: "That photo is too large. Keep it under 3 MB"}, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectPhotoType(bytes);
  if (!type) return respond({error: "Use a JPG, PNG or WebP photo"}, 415);

  try {
    const client = createSanityServerClient();
    const asset = await client.assets.upload("image", Buffer.from(bytes), {
      filename: `submission.${type.extension}`,
      contentType: type.contentType,
    });
    const id = newSubmissionId();
    const document = buildSubmissionDocument({
      id,
      fields,
      contact: encryptBuyerContact(fields.name, fields.email),
      photoAssetId: asset._id,
      now: new Date(),
    });
    await client.create(document as {_type: string; _id: string});
    return respond({reference: publicSubmissionReference(id)}, 201);
  } catch {
    return respond({error: "We couldn't save your fabric. Try again in a moment"}, 500);
  }
}
