import {NextResponse} from "next/server";

import {createSanityServerClient} from "../../../../lib/sanity/client";
import {checkWorkshopPin} from "../../../../lib/workshop/auth";
import {fetchBoard} from "../../../../lib/workshop/board";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const NO_STORE = {"Cache-Control": "no-store"};

export async function GET(request: Request): Promise<NextResponse> {
  const check = checkWorkshopPin(request.headers);
  if (check === "unconfigured") return NextResponse.json({error: "The board is unavailable right now"}, {status: 503, headers: NO_STORE});
  if (check === "unauthorized") return NextResponse.json({error: "Unauthorized"}, {status: 401, headers: NO_STORE});
  try {
    return NextResponse.json({columns: await fetchBoard(createSanityServerClient())}, {headers: NO_STORE});
  } catch {
    return NextResponse.json({error: "Unable to load the board"}, {status: 500, headers: NO_STORE});
  }
}
