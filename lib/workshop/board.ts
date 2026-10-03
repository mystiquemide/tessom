import type {SanityReadClient} from "../sanity/client";
import {sanityImageUrl, type SanityImageSource} from "../sanity/image";
import {decryptBuyerContact} from "../sanity/orders";
import {formatPrice} from "../shop";

export type ColumnId = "awaiting-consent" | "listed" | "allocated" | "cut" | "sewn" | "shipped";
export type BoardAction = "mark-cut" | "mark-sewn" | "mark-shipped";

export interface BoardCard {
  id: string;
  title: string;
  subtitle: string;
  details: string[];
  photoUrl: string | null;
  /** Set on order cards. The advance route needs it to move the order. */
  workflowInstanceId?: string;
  action?: {name: BoardAction; label: string};
}

export interface BoardColumn {
  id: ColumnId;
  title: string;
  empty: string;
  cards: BoardCard[];
}

export const BOARD_QUERY = `{
  "remnants": *[_type == "remnant" && status in ["intake", "consented", "listed"]] | order(_id asc){
    _id, title, status, widthCm, heightCm, photo, "owner": owner->name
  },
  "orders": *[_type == "order"] | order(createdAt asc){
    _id, createdAt, price, workflowInstanceId, buyerContact,
    "remnantTitle": remnant->title,
    "remnantPhoto": remnant->photo,
    "templateName": template->name,
    "stage": *[_type == "sanity.workflow.instance" && _id == ^.workflowInstanceId][0].currentStage
  }
}`;

interface RawRemnant {
  _id: string;
  title: string;
  status: string;
  widthCm: number;
  heightCm: number;
  photo?: SanityImageSource | null;
  owner?: string | null;
}

interface RawOrder {
  _id: string;
  createdAt?: string;
  price?: number;
  workflowInstanceId?: string;
  buyerContact?: unknown;
  remnantTitle?: string | null;
  remnantPhoto?: SanityImageSource | null;
  templateName?: string | null;
  stage?: string | null;
}

export interface RawBoard {
  remnants: RawRemnant[];
  orders: RawOrder[];
}

const NEXT_ACTION: Record<string, {name: BoardAction; label: string}> = {
  allocated: {name: "mark-cut", label: "Mark cut"},
  cut: {name: "mark-sewn", label: "Mark sewn"},
  sewn: {name: "mark-shipped", label: "Mark shipped"},
};

/** Column for an order's workflow stage. Anything past sewn counts as shipped. */
export function orderColumn(stage: string | null | undefined): ColumnId {
  if (stage === "cut" || stage === "sewn") return stage;
  if (stage === "allocated" || !stage) return "allocated";
  return "shipped";
}

function buyerFirstName(contact: unknown, environment: Record<string, string | undefined>): string | null {
  if (!contact) return null;
  try {
    const name = decryptBuyerContact(contact, environment).buyerName.trim();
    return name.split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

function formatDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en-US", {month: "short", day: "numeric", timeZone: "UTC"});
}

export function buildBoard(data: RawBoard, environment: Record<string, string | undefined> = process.env): BoardColumn[] {
  const columns: BoardColumn[] = [
    {id: "awaiting-consent", title: "Awaiting consent", empty: "Nothing waiting on an owner.", cards: []},
    {id: "listed", title: "Listed", empty: "Nothing is listed.", cards: []},
    {id: "allocated", title: "Allocated", empty: "No new orders.", cards: []},
    {id: "cut", title: "Cut", empty: "Nothing cut.", cards: []},
    {id: "sewn", title: "Sewn", empty: "Nothing sewn.", cards: []},
    {id: "shipped", title: "Shipped", empty: "Nothing shipped.", cards: []},
  ];
  const byId = new Map(columns.map((column) => [column.id, column]));

  for (const remnant of data.remnants) {
    const column = byId.get(remnant.status === "listed" ? "listed" : "awaiting-consent")!;
    column.cards.push({
      id: remnant._id,
      title: remnant.title,
      subtitle: remnant.owner ? `Owner: ${remnant.owner}` : "No owner recorded",
      details: [`${remnant.widthCm} × ${remnant.heightCm} cm`],
      photoUrl: sanityImageUrl(remnant.photo, 240),
    });
  }

  for (const order of data.orders) {
    const column = byId.get(orderColumn(order.stage))!;
    const buyer = buyerFirstName(order.buyerContact, environment);
    const when = formatDate(order.createdAt);
    column.cards.push({
      id: order._id,
      title: order.remnantTitle ?? "Unknown fabric",
      subtitle: [order.templateName, typeof order.price === "number" ? formatPrice(order.price) : null].filter(Boolean).join(" · "),
      details: [buyer ? `For ${buyer}` : null, when ? `Ordered ${when}` : null].filter((line): line is string => line !== null),
      photoUrl: sanityImageUrl(order.remnantPhoto, 240),
      workflowInstanceId: order.workflowInstanceId,
      action: order.workflowInstanceId && order.stage ? NEXT_ACTION[order.stage] : undefined,
    });
  }
  return columns;
}

export async function fetchBoard(client: SanityReadClient, environment: Record<string, string | undefined> = process.env): Promise<BoardColumn[]> {
  return buildBoard(await client.fetch<RawBoard>(BOARD_QUERY), environment);
}
