import {NextResponse} from "next/server";

import {fingerprintOffer} from "../../../../lib/orders";
import {computeOffers} from "../../../../lib/offers";
import {DEFAULT_OFFER_RATES} from "../../../../lib/offers/rates";
import {fetchOrderContext} from "../../../../lib/sanity";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type OffersRouteContext = {
  params: Promise<{remnantId: string}>;
};

const SANITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PUBLIC_STATUSES = new Set(["listed", "allocated"]);
const NO_STORE_HEADERS = {"Cache-Control": "no-store"};

function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function isValidRemnantId(value: unknown): value is string {
  return typeof value === "string" && SANITY_ID_PATTERN.test(value);
}

export async function GET(_request: Request, context: OffersRouteContext): Promise<NextResponse> {
  let remnantId: string;
  try {
    const params = await context.params;
    remnantId = params.remnantId;
  } catch {
    return jsonResponse({error: "Invalid remnant ID"}, 400);
  }

  if (!isValidRemnantId(remnantId)) {
    return jsonResponse({error: "Invalid remnant ID"}, 400);
  }

  try {
    const contextData = await fetchOrderContext(remnantId);
    if (!contextData) {
      return jsonResponse({error: "Remnant not found"}, 404);
    }
    if (!PUBLIC_STATUSES.has(contextData.remnant.status)) {
      return jsonResponse({error: "Remnant not available"}, 404);
    }

    const offers = computeOffers(contextData.remnant, contextData.templates, DEFAULT_OFFER_RATES);
    return jsonResponse({
      remnantId: contextData.remnant._id,
      revision: contextData.remnant._rev,
      offers: offers.map((offer) => ({
        templateId: offer.templateId,
        placement: offer.placement,
        usedArea: offer.usedArea,
        price: offer.price,
        ownerShare: offer.ownerShare,
        fingerprint: fingerprintOffer(offer),
      })),
    });
  } catch {
    return jsonResponse({error: "Unable to load offers"}, 500);
  }
}
