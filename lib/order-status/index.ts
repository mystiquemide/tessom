import type {Rect} from "../offers";
import type {SanityReadClient} from "../sanity/client";
import {sanityImageUrl, type SanityImageSource} from "../sanity/image";
import {orderColumn} from "../workshop/board";

export const ORDER_STEPS = ["Reserved", "Cut", "Sewn", "Shipped"] as const;
export type OrderStep = (typeof ORDER_STEPS)[number];

export const ORDER_STATUS_QUERY = `*[_type == "order" && _id == $id][0]{
  _id, createdAt, price, placement,
  "templateName": template->name,
  "remnantTitle": remnant->title,
  "widthCm": remnant->widthCm,
  "heightCm": remnant->heightCm,
  "photo": remnant->photo,
  "stage": *[_type == "sanity.workflow.instance" && _id == ^.workflowInstanceId][0].currentStage
}`;

interface RawOrderStatus {
  _id: string;
  createdAt?: string;
  price?: number;
  placement?: (Rect & {rotated?: boolean})[];
  templateName?: string | null;
  remnantTitle?: string | null;
  widthCm?: number | null;
  heightCm?: number | null;
  photo?: SanityImageSource | null;
  stage?: string | null;
}

/** What a buyer may see about their own order. It never includes a name or an email. */
export interface OrderStatus {
  id: string;
  title: string;
  productName: string;
  price: number | null;
  orderedOn: string | null;
  widthCm: number;
  heightCm: number;
  photoUrl: string | null;
  pieces: Rect[];
  step: OrderStep;
}

const STEP_BY_COLUMN: Record<string, OrderStep> = {allocated: "Reserved", cut: "Cut", sewn: "Sewn", shipped: "Shipped"};

export function buildOrderStatus(raw: RawOrderStatus | null | undefined): OrderStatus | null {
  if (!raw || !raw.widthCm || !raw.heightCm) return null;
  const date = raw.createdAt ? new Date(raw.createdAt) : null;
  return {
    id: raw._id,
    title: raw.remnantTitle ?? "Your fabric",
    productName: raw.templateName ?? "Your order",
    price: typeof raw.price === "number" ? raw.price : null,
    orderedOn: date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-US", {month: "long", day: "numeric", year: "numeric", timeZone: "UTC"}) : null,
    widthCm: raw.widthCm,
    heightCm: raw.heightCm,
    photoUrl: sanityImageUrl(raw.photo, 1200),
    pieces: (raw.placement ?? []).map(({x, y, w, h}) => ({x, y, w, h})),
    step: STEP_BY_COLUMN[orderColumn(raw.stage)],
  };
}

export async function fetchOrderStatus(client: SanityReadClient, id: string): Promise<OrderStatus | null> {
  return buildOrderStatus(await client.fetch<RawOrderStatus | null>(ORDER_STATUS_QUERY, {id}));
}
