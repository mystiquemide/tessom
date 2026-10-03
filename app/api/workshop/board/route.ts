import {NextResponse} from "next/server";

import {createSanityServerClient} from "../../../../lib/sanity/client";
import {tooManyRequests} from "../../../../lib/http/rate-limit";
import {checkWorkshopPin} from "../../../../lib/workshop/auth";
import {pinAttemptsBlocked, recordPinFailure} from "../../../../lib/workshop/pin-guard";
import {fetchBoard} from "../../../../lib/workshop/board";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const NO_STORE = {"Cache-Control": "no-store"};

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
    return NextResponse.json({columns: await fetchBoard(createSanityServerClient())}, {headers: NO_STORE});
  } catch {
    return NextResponse.json({error: "Unable to load the board"}, {status: 500, headers: NO_STORE});
  }
}
