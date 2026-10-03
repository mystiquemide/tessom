import type {CutPlanPiece} from "../../components/cut-plan";
import {computeOffers, describePieces, type ProductTemplate, type Rect, type Remnant} from "../offers";
import {fingerprintOffer} from "../orders";
import {DEFAULT_OFFER_RATES} from "../offers/rates";
import {sanityImageUrl, type SanityImageSource} from "../sanity/image";
import {createPublicReadClient} from "../sanity/public";
import type {SanityReadClient} from "../sanity/client";

export const KIND_LABELS = {
  cushion: "Cushions",
  "bench-pad": "Bench pads",
  lumbar: "Lumbar cushions",
  "seat-pad": "Seat pads",
  tote: "Totes",
} as const;

export type ShopKind = keyof typeof KIND_LABELS;

export function isShopKind(value: unknown): value is ShopKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(KIND_LABELS, value);
}

export interface ShopOffer {
  id: string;
  name: string;
  kind: string;
  imageUrl: string | null;
  /** Server fingerprint of this exact offer, sent back with an order so a stale offer is refused. */
  fingerprint: string;
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
  repeat: {vCm?: number; hCm?: number} | null;
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
  templates: (ProductTemplate & {_id: string; image?: SanityImageSource | null})[];
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
    _id, name, kind, pieces[]{label, wCm, hCm, qty, centerPattern}, seamCm, labourMin, fillCost, active, image
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
        kind: template.kind ?? "",
        imageUrl: sanityImageUrl(template.image, 320),
        fingerprint: fingerprintOffer(offer),
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
      repeat: remnant.repeat && (remnant.repeat.vCm || remnant.repeat.hCm) ? {vCm: remnant.repeat.vCm, hCm: remnant.repeat.hCm} : null,
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

export interface ShopStats {
  pieces: number;
  offers: number;
  areaM2: number;
}

/** What is on the table right now, counted from the remnants that can be ordered. */
export function shopStats(remnants: readonly ShopRemnant[]): ShopStats {
  const open = orderable(remnants);
  const areaCm2 = open.reduce((total, remnant) => total + remnant.widthCm * remnant.heightCm, 0);
  return {
    pieces: open.length,
    offers: open.reduce((total, remnant) => total + remnant.offers.length, 0),
    areaM2: Math.round(areaCm2 / 1000) / 10,
  };
}

/** Remnants that have an offer of this kind. Each keeps only the offers of that kind. Sold areas stay drawn. */
export function filterByKind(remnants: readonly ShopRemnant[], kind: ShopKind | null): ShopRemnant[] {
  if (kind === null) return [...remnants];
  return remnants
    .map((remnant) => ({...remnant, offers: remnant.offers.filter((offer) => offer.kind === kind)}))
    .filter((remnant) => remnant.offers.length > 0);
}

/** Item types with at least one orderable remnant, in catalogue order, with how many remnants offer each. */
export function availableKinds(remnants: readonly ShopRemnant[]): {kind: ShopKind; count: number}[] {
  const open = orderable(remnants);
  return (Object.keys(KIND_LABELS) as ShopKind[])
    .map((kind) => ({kind, count: open.filter((remnant) => remnant.offers.some((offer) => offer.kind === kind)).length}))
    .filter((entry) => entry.count > 0);
}

/** Orderable remnants first (most offers first), then partly sold ones, then anything too small to offer. */
export function shelfOrder(remnants: readonly ShopRemnant[]): ShopRemnant[] {
  const rank = (remnant: ShopRemnant): number => (remnant.status === "listed" && remnant.offers.length > 0 ? 0 : remnant.offers.length > 0 ? 1 : 2);
  return [...remnants].sort((a, b) => rank(a) - rank(b) || b.offers.length - a.offers.length || a.id.localeCompare(b.id));
}

export function findShopRemnant(remnants: readonly ShopRemnant[], id: string): ShopRemnant | undefined {
  return remnants.find((remnant) => remnant.id === id);
}

/** "2 × Front 45×45 · Back 45×45", with identical pieces grouped. */
export function describeOfferPieces(offer: ShopOffer, separator = " · "): string {
  const counts = new Map<string, number>();
  for (const piece of offer.pieces) {
    const key = `${piece.label} ${piece.wCm}×${piece.hCm}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => (count > 1 ? `${count} × ${key}` : key)).join(separator);
}

/** Plain-language facts about how a remnant was planned. Only states what the data says. */
export function planningFacts(remnant: ShopRemnant): string[] {
  const facts = [`${remnant.widthCm} × ${remnant.heightCm} cm of ${remnant.fabricName}${remnant.maker ? ` from ${remnant.maker}` : ""}.`];
  facts.push(
    remnant.directional
      ? "This fabric has a direction, so every panel is cut the same way up. Nothing is turned."
      : "This fabric has no direction, so panels can be turned to fit.",
  );
  if (remnant.repeat) {
    const parts = [remnant.repeat.vCm ? `${remnant.repeat.vCm} cm down` : null, remnant.repeat.hCm ? `${remnant.repeat.hCm} cm across` : null].filter(Boolean);
    facts.push(`The pattern repeats every ${parts.join(" and ")}. Panels are placed to line up with it.`);
  }
  if (remnant.defects.length > 0) {
    facts.push(`${remnant.defects.length === 1 ? "One flaw is" : `${remnant.defects.length} flaws are`} hatched on the plan. No panel is cut over a flaw.`);
  }
  if (remnant.allocations.length > 0) {
    facts.push(`${remnant.allocations.length === 1 ? "One area is" : `${remnant.allocations.length} areas are`} already ordered and shown darkened.`);
  }
  return facts;
}

/** "1 cut to choose from", "4 cuts to choose from". */
export function cutsLabel(count: number): string {
  return `${count} ${count === 1 ? "cut" : "cuts"} to choose from`;
}
