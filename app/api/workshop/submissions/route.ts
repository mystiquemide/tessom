import {NextResponse} from "next/server";

import {tooManyRequests} from "../../../../lib/http/rate-limit";
import {createSanityServerClient} from "../../../../lib/sanity/client";
import {buildSubmissionCards, SUBMISSIONS_QUERY, type RawSubmission} from "../../../../lib/submissions/review";
import {checkWorkshopPin} from "../../../../lib/workshop/auth";
import {pinAttemptsBlocked, recordPinFailure} from "../../../../lib/workshop/pin-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const NO_STORE = {"Cache-Control": "no-store"};

/** New fabric offers waiting for the workshop. PIN only. First names only, never an email. */
export async function GET(request: Request): Promise<NextResponse> {
  const waitSec = pinAttemptsBlocked(request);
  if (waitSec !== null) return tooManyRequests(waitSec);
  const check = checkWorkshopPin(request.headers);
  if (check === "unconfigured") return NextResponse.json({error: "The board is unavailable right now"}, {status: 503, headers: NO_STORE});
  if (check === "unauthorized") {
    recordPinFailure(request);
    return NextResponse.json({error: "Unauthorized"}, {status: 401, headers: NO_STORE});
  }
  try {
    const raw = await createSanityServerClient().fetch<RawSubmission[]>(SUBMISSIONS_QUERY);
    return NextResponse.json({submissions: buildSubmissionCards(raw)}, {headers: NO_STORE});
  } catch {
    return NextResponse.json({error: "Unable to load the offers"}, {status: 500, headers: NO_STORE});
  }
}
