import {NextResponse} from "next/server";
import {z} from "zod";

import {MAX_JSON_BODY_BYTES, readJsonBody} from "../../../../lib/http/json-body";
import {SANITY_DOCUMENT_ID_PATTERN} from "../../../../lib/http/sanity-id";
import {createSanityServerClient} from "../../../../lib/sanity/client";
import {decryptBuyerContact} from "../../../../lib/sanity/orders";
import {checkWorkshopPin} from "../../../../lib/workshop/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const NO_STORE = {"Cache-Control": "no-store"};
const bodySchema = z.object({orderId: z.string().trim().regex(SANITY_DOCUMENT_ID_PATTERN)}).strict();

function respond(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {status, headers: NO_STORE});
}

/** Shows the workshop who ordered, so it can email them to arrange payment and shipping. PIN only. */
export async function POST(request: Request): Promise<NextResponse> {
  const check = checkWorkshopPin(request.headers);
  if (check === "unconfigured") return respond({error: "The workshop board is not set up on this server"}, 503);
  if (check === "unauthorized") return respond({error: "Unauthorized"}, 401);

  let orderId: string;
  try {
    const parsed = bodySchema.safeParse(await readJsonBody(request, MAX_JSON_BODY_BYTES));
    if (!parsed.success) return respond({error: "Invalid request"}, 400);
    orderId = parsed.data.orderId;
  } catch {
    return respond({error: "Invalid request"}, 400);
  }

  try {
    const order = await createSanityServerClient().fetch<{buyerContact?: unknown} | null>(
      `*[_type == "order" && _id == $id][0]{buyerContact}`,
      {id: orderId},
    );
    if (!order?.buyerContact) return respond({error: "Order not found"}, 404);
    const {buyerName, buyerEmail} = decryptBuyerContact(order.buyerContact);
    return respond({name: buyerName, email: buyerEmail}, 200);
  } catch {
    return respond({error: "Couldn't read this contact"}, 500);
  }
}
