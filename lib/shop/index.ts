import type {CutPlanPiece} from "../../components/cut-plan";
import {computeOffers, describePieces, type ProductTemplate, type Rect, type Remnant} from "../offers";
import {DEFAULT_OFFER_RATES} from "../offers/rates";
import {sanityImageUrl, type SanityImageSource} from "../sanity/image";
import {createPublicReadClient} from "../sanity/public";
import type {SanityReadClient} from "../sanity/client";

export interface ShopOffer {
  id: string;
  name: string;
  price: number;
  ownerShare: number;
  pieces: CutPlanPiece[];
}

export interface ShopRemnant {
  id: string;
  title: string;
  fabricName: string;
  maker: string;
  status: string;
  widthCm: number;
  heightCm: number;
  directional: boolean;
  photoUrl: string | null;
  defects: Rect[];
  allocations: Rect[];
  offers: ShopOffer[];
}

interface RawRemnant extends Remnant {
  _id: string;
  title: string;
  status: string;
  photo?: SanityImageSource | null;
}

interface RawShopData {
  remnants: RawRemnant[];
  templates: (ProductTemplate & {_id: string})[];
}

export const SHOP_QUERY = `{
  "remnants": *[_type == "remnant" && status in ["listed", "allocated"]] | order(_id asc){
    _id, title, status, widthCm, heightCm, directional,
    repeat{vCm, hCm},
    fabric{name, maker, valuePerM},
    defects[]{x, y, w, h},
    allocations[]{x, y, w, h},
    "ownerShareBps": owner->shareBps,
    photo
  },
  "templates": *[_type == "productTemplate" && active == true] | order(_id asc){
    _id, name, kind, pieces[]{label, wCm, hCm, qty, centerPattern}, seamCm, labourMin, fillCost, active
  }
}`;

/** Offers and labelled pieces for every remnant, computed with the same engine that prices orders. */
export function buildShopRemnants(data: RawShopData, photoWidth = 1200): ShopRemnant[] {
  const templates = new Map(data.templates.map((template) => [template._id, template]));
  return data.remnants.map((remnant) => {
    const offers: ShopOffer[] = [];
    for (const offer of computeOffers(remnant, data.templates, DEFAULT_OFFER_RATES)) {
      const template = templates.get(offer.templateId);
      const described = template ? describePieces(template) : undefined;
      if (!template || !described || described.length !== offer.placement.length) continue;
      offers.push({
        id: offer.templateId,
        name: template.name,
        price: offer.price,
        ownerShare: offer.ownerShare,
        pieces: offer.placement.map((placement, index) => ({...placement, ...described[index]})),
      });
    }
    return {
      id: remnant._id,
      title: remnant.title,
      fabricName: remnant.fabric.name ?? remnant.title,
      maker: remnant.fabric.maker ?? "",
      status: remnant.status,
      widthCm: remnant.widthCm,
      heightCm: remnant.heightCm,
      directional: remnant.directional === true,
      photoUrl: sanityImageUrl(remnant.photo, photoWidth),
      defects: remnant.defects ?? [],
      allocations: remnant.allocations ?? [],
      offers,
    };
  });
}

export async function fetchShopRemnants(client: SanityReadClient | null = createPublicReadClient()): Promise<ShopRemnant[]> {
  if (!client) return [];
  try {
    return buildShopRemnants(await client.fetch<RawShopData>(SHOP_QUERY));
  } catch {
    return [];
  }
}

/** Remnants that can be ordered from right now, most offers first. */
export function orderable(remnants: readonly ShopRemnant[]): ShopRemnant[] {
  return remnants
    .filter((remnant) => remnant.status === "listed" && remnant.offers.length > 0)
    .sort((a, b) => b.offers.length - a.offers.length || a.id.localeCompare(b.id));
}

export function fromPrice(remnant: ShopRemnant): number | null {
  return remnant.offers.length === 0 ? null : Math.min(...remnant.offers.map((offer) => offer.price));
}

export function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}
