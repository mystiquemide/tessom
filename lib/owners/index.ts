import type {SanityReadClient} from "../sanity/client";
import {sanityImageUrl, type SanityImageSource} from "../sanity/image";
import {orderColumn} from "../workshop/board";

export const OWNER_KIND_LABELS: Record<string, string> = {client: "Client", designer: "Designer", workshop: "Workshop"};

export const OWNERS_QUERY = `{
  "owners": *[_type == "owner"] | order(name asc){_id, name, kind, shareBps},
  "remnants": *[_type == "remnant"] | order(_id asc){_id, title, status, widthCm, heightCm, photo, "ownerId": owner._ref},
  "orders": *[_type == "order"] | order(createdAt asc){
    _id, ownerShare, "remnantId": remnant._ref,
    "stage": *[_type == "sanity.workflow.instance" && _id == ^.workflowInstanceId][0].currentStage
  }
}`;

export interface RawOwners {
  owners: {_id: string; name: string; kind?: string; shareBps?: number}[];
  remnants: {_id: string; title: string; status: string; widthCm: number; heightCm: number; photo?: SanityImageSource | null; ownerId?: string | null}[];
  orders: {_id: string; ownerShare?: number; remnantId?: string; stage?: string | null}[];
}

export interface OwnerRemnant {
  id: string;
  title: string;
  widthCm: number;
  heightCm: number;
  photoUrl: string | null;
  stageLabel: string;
  /** Awaiting the owner's decision. */
  awaitingConsent: boolean;
  earned: number;
}

export interface Owner {
  id: string;
  name: string;
  kindLabel: string;
  sharePercent: number | null;
  earned: number;
  remnants: OwnerRemnant[];
}

const COLUMN_LABELS = {allocated: "Reserved", cut: "Cut", sewn: "Sewn", shipped: "Shipped"} as const;

/** Where a piece is in its life, in the owner's words. */
export function stageLabel(status: string, latestOrderStage: string | null | undefined, hasOrder: boolean): string {
  if (status === "intake" || status === "consented") return "Awaiting consent";
  if (status === "listed") return "Listed";
  if (status === "returned") return "Declined";
  if (hasOrder) {
    const column = orderColumn(latestOrderStage);
    if (column in COLUMN_LABELS) return COLUMN_LABELS[column as keyof typeof COLUMN_LABELS];
  }
  return status === "sold-out" ? "Sold out" : "Ordered";
}

const round = (value: number) => Math.round(value * 100) / 100;

export function buildOwners(data: RawOwners): Owner[] {
  return data.owners.map((owner) => {
    const remnants = data.remnants
      .filter((remnant) => remnant.ownerId === owner._id)
      .map<OwnerRemnant>((remnant) => {
        const orders = data.orders.filter((order) => order.remnantId === remnant._id);
        const latest = orders[orders.length - 1];
        return {
          id: remnant._id,
          title: remnant.title,
          widthCm: remnant.widthCm,
          heightCm: remnant.heightCm,
          photoUrl: sanityImageUrl(remnant.photo, 320),
          stageLabel: stageLabel(remnant.status, latest?.stage, orders.length > 0),
          awaitingConsent: remnant.status === "intake" || remnant.status === "consented",
          earned: round(orders.reduce((sum, order) => sum + (order.ownerShare ?? 0), 0)),
        };
      });
    return {
      id: owner._id,
      name: owner.name,
      kindLabel: OWNER_KIND_LABELS[owner.kind ?? ""] ?? "Owner",
      sharePercent: typeof owner.shareBps === "number" ? owner.shareBps / 100 : null,
      earned: round(remnants.reduce((sum, remnant) => sum + remnant.earned, 0)),
      remnants,
    };
  });
}

export async function fetchOwners(client: SanityReadClient): Promise<Owner[]> {
  return buildOwners(await client.fetch<RawOwners>(OWNERS_QUERY));
}
