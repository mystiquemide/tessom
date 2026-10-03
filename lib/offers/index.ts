/**
 * The geometry used by the offer engine is deliberately small. A remnant,
 * every defect, every allocation, and every cut piece is a rectangle in cm.
 * Keeping these types here means the engine can be used by route handlers and
 * tests without importing Sanity or any UI code.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Repeat {
  /** Vertical repeat, measured along the y axis, in cm. */
  vCm?: number;
  /** Horizontal repeat, measured along the x axis, in cm. */
  hCm?: number;
}

export interface RemnantFabric {
  name?: string;
  maker?: string;
  /** Value of one linear metre of fabric at the remnant's usable width. */
  valuePerM: number;
}

export interface RemnantOwner {
  /** Basis points of the fabric component paid to the owner. */
  shareBps?: number;
}

export interface Remnant {
  id?: string;
  _id?: string;
  title?: string;
  widthCm: number;
  heightCm: number;
  fabric: RemnantFabric;
  repeat?: Repeat | null;
  directional?: boolean;
  defects?: Rect[];
  allocations?: Rect[];
  owner?: RemnantOwner | null;
  /** Useful when a query has projected the owner's share onto the remnant. */
  ownerShareBps?: number;
  shareBps?: number;
}

export interface TemplatePiece {
  label: string;
  wCm: number;
  hCm: number;
  qty?: number;
  centerPattern?: boolean;
}

export interface ProductTemplate {
  id?: string;
  _id?: string;
  templateId?: string;
  name: string;
  kind?: string;
  pieces: TemplatePiece[];
  /** Seam allowance is added to both sides of each dimension. */
  seamCm?: number;
  labourMin?: number;
  fillCost?: number;
  active?: boolean;
}

export interface OfferRates {
  /** Cost per labour minute. */
  labourPerMinute?: number;
  labourPerMin?: number;
  labourRate?: number;
  labourRatePerMinute?: number;
  labourRatePerMin?: number;
  laborPerMinute?: number;
  laborPerMin?: number;
  laborRate?: number;
  laborRatePerMinute?: number;
  laborRatePerMin?: number;
  ratePerMinute?: number;
  marginMultiplier?: number;
  /** Minimum unrounded margin in currency units. */
  marginFloor?: number;
  /** Basis points of the margin added to the owner's fabric share. */
  ownerMarginSliceBps?: number;
  marginSliceBps?: number;
  ownerMarginBps?: number;
  /** Optional decimal form of ownerMarginSliceBps, for callers using 0.2. */
  ownerMarginSlice?: number;
  ownerShareBps?: number;
  currencyDecimals?: number;
  decimals?: number;
}

export interface Placement extends Rect {
  rotated: boolean;
}

export interface Offer {
  templateId: string;
  placement: Placement[];
  /** Total cut area, including seam allowance, in cm2. */
  usedArea: number;
  price: number;
  ownerShare: number;
}

export const CONSIGNMENT_RATE = 0.5;

const EPSILON = 1e-9;

interface WorkPiece {
  label: string;
  w: number;
  h: number;
  centerPattern: boolean;
  originalIndex: number;
  quantityIndex: number;
}

interface PlacementCandidate {
  rect: Rect;
  rotated: boolean;
  freeIndex: number;
  shortSide: number;
  longSide: number;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > EPSILON;
}

function approximatelyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON;
}

function area(rect: Rect): number {
  return rect.w * rect.h;
}

function right(rect: Rect): number {
  return rect.x + rect.w;
}

function bottom(rect: Rect): number {
  return rect.y + rect.h;
}

function normalizeNumber(value: number): number {
  // Removing harmless binary noise keeps a server recomputation byte-stable.
  return Math.abs(value) < EPSILON ? 0 : Number(value.toFixed(10));
}

function compareNumbers(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function normalizeRect(rect: Rect): Rect {
  return {
    x: normalizeNumber(rect.x),
    y: normalizeNumber(rect.y),
    w: normalizeNumber(rect.w),
    h: normalizeNumber(rect.h),
  };
}

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < right(b) - EPSILON &&
    right(a) > b.x + EPSILON &&
    a.y < bottom(b) - EPSILON &&
    bottom(a) > b.y + EPSILON
  );
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - EPSILON &&
    inner.y >= outer.y - EPSILON &&
    right(inner) <= right(outer) + EPSILON &&
    bottom(inner) <= bottom(outer) + EPSILON
  );
}

function sortRects(rectangles: Rect[]): Rect[] {
  return rectangles
    .map(normalizeRect)
    .filter((rect) => positive(rect.w) && positive(rect.h))
    .sort((a, b) => {
      const xDifference = compareNumbers(a.x, b.x);
      if (xDifference !== 0) return xDifference;
      const yDifference = compareNumbers(a.y, b.y);
      if (yDifference !== 0) return yDifference;
      const widthDifference = compareNumbers(a.w, b.w);
      if (widthDifference !== 0) return widthDifference;
      return compareNumbers(a.h, b.h);
    });
}

function pruneContainedRectangles(rectangles: Rect[]): Rect[] {
  const ordered = sortRects(rectangles);
  return ordered.filter((rectangle, index) => {
    for (let otherIndex = 0; otherIndex < ordered.length; otherIndex += 1) {
      if (otherIndex === index) continue;
      const other = ordered[otherIndex];
      if (!contains(other, rectangle)) continue;
      // Equal duplicates are removed in their later sorted position. A
      // strictly larger rectangle removes a contained smaller rectangle.
      if (!contains(rectangle, other) || otherIndex < index) return false;
    }
    return true;
  });
}

function mergeFreeRectangles(rectangles: Rect[]): Rect[] {
  let merged = sortRects(rectangles);
  let changed = true;

  while (changed) {
    changed = false;
    outer: for (let i = 0; i < merged.length; i += 1) {
      for (let j = i + 1; j < merged.length; j += 1) {
        const a = merged[i];
        const b = merged[j];

        const horizontal =
          approximatelyEqual(a.y, b.y) &&
          approximatelyEqual(a.h, b.h) &&
          (approximatelyEqual(right(a), b.x) || approximatelyEqual(right(b), a.x));
        if (horizontal) {
          const leftRect = a.x <= b.x ? a : b;
          const rightRect = leftRect === a ? b : a;
          merged = [
            ...merged.slice(0, i),
            normalizeRect({
              x: leftRect.x,
              y: leftRect.y,
              w: right(rightRect) - leftRect.x,
              h: leftRect.h,
            }),
            ...merged.slice(i + 1, j),
            ...merged.slice(j + 1),
          ];
          changed = true;
          break outer;
        }

        const vertical =
          approximatelyEqual(a.x, b.x) &&
          approximatelyEqual(a.w, b.w) &&
          (approximatelyEqual(bottom(a), b.y) || approximatelyEqual(bottom(b), a.y));
        if (vertical) {
          const topRect = a.y <= b.y ? a : b;
          const bottomRect = topRect === a ? b : a;
          merged = [
            ...merged.slice(0, i),
            normalizeRect({
              x: topRect.x,
              y: topRect.y,
              w: topRect.w,
              h: bottom(bottomRect) - topRect.y,
            }),
            ...merged.slice(i + 1, j),
            ...merged.slice(j + 1),
          ];
          changed = true;
          break outer;
        }
      }
    }
  }

  return pruneContainedRectangles(merged);
}

function clipToBounds(rect: Rect, bounds: Rect): Rect | undefined {
  const x = Math.max(rect.x, bounds.x);
  const y = Math.max(rect.y, bounds.y);
  const r = Math.min(right(rect), right(bounds));
  const b = Math.min(bottom(rect), bottom(bounds));
  if (r <= x + EPSILON || b <= y + EPSILON) return undefined;
  return normalizeRect({ x, y, w: r - x, h: b - y });
}

function subtractOne(free: Rect, obstacle: Rect): Rect[] {
  if (!intersects(free, obstacle)) return [free];

  const overlapLeft = Math.max(free.x, obstacle.x);
  const overlapRight = Math.min(right(free), right(obstacle));
  const overlapTop = Math.max(free.y, obstacle.y);
  const overlapBottom = Math.min(bottom(free), bottom(obstacle));
  const next: Rect[] = [];

  if (overlapLeft > free.x + EPSILON) {
    next.push({ x: free.x, y: free.y, w: overlapLeft - free.x, h: free.h });
  }
  if (overlapRight < right(free) - EPSILON) {
    next.push({
      x: overlapRight,
      y: free.y,
      w: right(free) - overlapRight,
      h: free.h,
    });
  }
  if (overlapBottom > free.y + EPSILON) {
    next.push({
      x: free.x,
      y: free.y,
      w: free.w,
      h: overlapTop - free.y,
    });
  }
  if (overlapBottom < bottom(free) - EPSILON) {
    next.push({
      x: free.x,
      y: overlapBottom,
      w: free.w,
      h: bottom(free) - overlapBottom,
    });
  }

  return next;
}

function freeSpace(remnant: Remnant): { bounds: Rect; free: Rect[]; obstacles: Rect[] } | undefined {
  if (!positive(remnant.widthCm) || !positive(remnant.heightCm)) return undefined;
  const bounds: Rect = { x: 0, y: 0, w: remnant.widthCm, h: remnant.heightCm };
  const obstacles: Rect[] = [];
  const defects = Array.isArray(remnant.defects) ? remnant.defects : [];
  const allocations = Array.isArray(remnant.allocations) ? remnant.allocations : [];

  for (const source of [...defects, ...allocations]) {
    if (!source || !finite(source.x) || !finite(source.y) || !finite(source.w) || !finite(source.h)) {
      continue;
    }
    const clipped = clipToBounds(source, bounds);
    if (clipped) obstacles.push(clipped);
  }

  // Sanity arrays are user editable. Canonicalising them before subtraction
  // means the same snapshot produces the same free-space decomposition even
  // when defects and allocations arrive in a different order.
  const orderedObstacles = sortRects(obstacles);

  let free = [bounds];
  for (const obstacle of orderedObstacles) {
    free = mergeFreeRectangles(free.flatMap((rect) => subtractOne(rect, obstacle)));
    if (free.length === 0) break;
  }

  return { bounds, free, obstacles: orderedObstacles };
}

function numberFromAliases(source: Record<string, unknown>, names: string[], fallback: number): number {
  for (const name of names) {
    const value = source[name];
    if (finite(value)) return value;
  }
  return fallback;
}

function templateId(template: ProductTemplate): string {
  const candidates = [template.templateId, template.id, template._id, template.name];
  return candidates.find((candidate) => typeof candidate === "string" && candidate.length > 0) ?? "";
}

function expandPieces(template: ProductTemplate): WorkPiece[] | undefined {
  const seam = template.seamCm ?? 0;
  if (!finite(seam) || seam < -EPSILON || !Array.isArray(template.pieces)) return undefined;

  const expanded: WorkPiece[] = [];
  for (let pieceIndex = 0; pieceIndex < template.pieces.length; pieceIndex += 1) {
    const piece = template.pieces[pieceIndex];
    if (!piece || !positive(piece.wCm) || !positive(piece.hCm)) return undefined;
    const qty = piece.qty ?? 1;
    if (!Number.isInteger(qty) || qty < 1) return undefined;
    const w = piece.wCm + seam * 2;
    const h = piece.hCm + seam * 2;
    if (!positive(w) || !positive(h)) return undefined;

    for (let quantityIndex = 0; quantityIndex < qty; quantityIndex += 1) {
      expanded.push({
        label: piece.label || `piece-${pieceIndex + 1}`,
        w,
        h,
        centerPattern: piece.centerPattern === true,
        originalIndex: pieceIndex,
        quantityIndex,
      });
    }
  }

  if (expanded.length === 0) return undefined;

  // The final tie breakers are input positions, so equal pieces remain stable.
  return expanded.sort((a, b) => {
    const areaDifference = b.w * b.h - a.w * a.h;
    if (Math.abs(areaDifference) > EPSILON) return areaDifference;
    if (Math.abs(b.w - a.w) > EPSILON) return b.w - a.w;
    if (Math.abs(b.h - a.h) > EPSILON) return b.h - a.h;
    if (a.originalIndex !== b.originalIndex) return a.originalIndex - b.originalIndex;
    return a.quantityIndex - b.quantityIndex;
  });
}

function snapAtOrAfter(value: number, repeat: number | undefined): number {
  if (!positive(repeat)) return value;
  const multiple = Math.ceil((value - EPSILON) / repeat);
  return normalizeNumber(multiple * repeat);
}

function compareCandidates(a: PlacementCandidate, b: PlacementCandidate): number {
  const shortSideDifference = compareNumbers(a.shortSide, b.shortSide);
  if (shortSideDifference !== 0) return shortSideDifference;
  const longSideDifference = compareNumbers(a.longSide, b.longSide);
  if (longSideDifference !== 0) return longSideDifference;
  const yDifference = compareNumbers(a.rect.y, b.rect.y);
  if (yDifference !== 0) return yDifference;
  const xDifference = compareNumbers(a.rect.x, b.rect.x);
  if (xDifference !== 0) return xDifference;
  if (a.rotated !== b.rotated) return a.rotated ? 1 : -1;
  return a.freeIndex - b.freeIndex;
}

function candidateFor(
  piece: WorkPiece,
  width: number,
  height: number,
  rotated: boolean,
  free: Rect,
  freeIndex: number,
  repeat: Repeat | null | undefined,
): PlacementCandidate | undefined {
  const x = piece.centerPattern ? snapAtOrAfter(free.x, repeat?.hCm) : free.x;
  const y = piece.centerPattern ? snapAtOrAfter(free.y, repeat?.vCm) : free.y;
  const candidate: Rect = { x, y, w: width, h: height };
  if (!contains(free, candidate)) return undefined;

  const availableWidth = right(free) - x;
  const availableHeight = bottom(free) - y;
  const widthRemainder = availableWidth - width;
  const heightRemainder = availableHeight - height;
  if (widthRemainder < -EPSILON || heightRemainder < -EPSILON) return undefined;

  return {
    rect: normalizeRect(candidate),
    rotated,
    freeIndex,
    shortSide: Math.min(widthRemainder, heightRemainder),
    longSide: Math.max(widthRemainder, heightRemainder),
  };
}

function bestCandidate(
  piece: WorkPiece,
  free: Rect[],
  remnant: Remnant,
): PlacementCandidate | undefined {
  const candidates: PlacementCandidate[] = [];
  const orientations: Array<{ w: number; h: number; rotated: boolean }> = [
    { w: piece.w, h: piece.h, rotated: false },
  ];
  if (!remnant.directional && !approximatelyEqual(piece.w, piece.h)) {
    orientations.push({ w: piece.h, h: piece.w, rotated: true });
  }

  for (let freeIndex = 0; freeIndex < free.length; freeIndex += 1) {
    for (const orientation of orientations) {
      const candidate = candidateFor(
        piece,
        orientation.w,
        orientation.h,
        orientation.rotated,
        free[freeIndex],
        freeIndex,
        remnant.repeat,
      );
      if (candidate) candidates.push(candidate);
    }
  }

  return candidates.sort(compareCandidates)[0];
}

function subtractPlacement(free: Rect[], placement: Rect): Rect[] {
  return mergeFreeRectangles(free.flatMap((rect) => subtractOne(rect, placement)));
}

function validPlacement(
  placement: Rect,
  bounds: Rect,
  obstacles: Rect[],
  previous: Placement[],
): boolean {
  if (!contains(bounds, placement)) return false;
  if (obstacles.some((obstacle) => intersects(placement, obstacle))) return false;
  return !previous.some((other) => intersects(placement, other));
}

function getOwnerShareBps(remnant: Remnant, rates: OfferRates): number {
  const remnantRecord = remnant as Remnant & Record<string, unknown>;
  const owner = remnant.owner as (RemnantOwner & Record<string, unknown>) | null | undefined;
  const ownerRecord = owner && typeof owner === "object" ? owner : undefined;
  const ownerValue = ownerRecord?.shareBps;
  const direct = remnant.ownerShareBps ?? remnant.shareBps;
  const configured = rates.ownerShareBps;
  const value = [ownerValue, direct, configured].find(finite);
  const fallback = finite(remnantRecord.ownerShare) ? remnantRecord.ownerShare : 2000;
  return Math.min(10_000, Math.max(0, value ?? fallback));
}

function getMarginSliceFraction(rates: OfferRates): number {
  const record = rates as OfferRates & Record<string, unknown>;
  const bps = [rates.ownerMarginSliceBps, rates.marginSliceBps, rates.ownerMarginBps].find(finite);
  if (bps !== undefined) return Math.min(10_000, Math.max(0, bps)) / 10_000;
  const decimal = record.ownerMarginSlice;
  if (finite(decimal)) {
    const fraction = decimal <= 1 ? decimal : decimal / 10_000;
    return Math.min(1, Math.max(0, fraction));
  }
  return 0;
}

function currencyDecimals(rates: OfferRates): number {
  const configured = rates.currencyDecimals ?? rates.decimals ?? 2;
  if (!finite(configured)) return 2;
  return Math.max(0, Math.min(6, Math.floor(configured)));
}

function roundCurrency(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  // Scale the adjustment with the value so halfway decimal amounts such as
  // 10.075 survive binary floating point conversion before rounding.
  const epsilon = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  return normalizeNumber(Math.round(scaled + Math.sign(scaled || 1) * epsilon) / factor);
}

function labourRate(rates: OfferRates): number {
  const record = rates as OfferRates & Record<string, unknown>;
  return Math.max(
    0,
    numberFromAliases(
      record,
      [
        "labourPerMinute",
        "labourPerMin",
        "labourRate",
        "labourRatePerMinute",
        "labourRatePerMin",
        "laborPerMinute",
        "laborPerMin",
        "laborRate",
        "laborRatePerMinute",
        "laborRatePerMin",
        "ratePerMinute",
      ],
      0,
    ),
  );
}

function fabricComponent(remnant: Remnant, usedArea: number): number {
  const valuePerM = remnant.fabric?.valuePerM;
  if (!finite(valuePerM) || valuePerM < 0) return Number.NaN;

  // valuePerM is a linear-metre price. The remnant width is the usable bolt
  // width, so one linear metre contains widthCm * 100 square centimetres.
  const squareCentimetresPerLinearMetre = remnant.widthCm * 100;
  if (!positive(squareCentimetresPerLinearMetre)) return Number.NaN;
  return (usedArea / squareCentimetresPerLinearMetre) * valuePerM * CONSIGNMENT_RATE;
}

function priceOffer(
  remnant: Remnant,
  template: ProductTemplate,
  usedArea: number,
  rates: OfferRates,
): { price: number; ownerShare: number } | undefined {
  const fabric = fabricComponent(remnant, usedArea);
  const labourMin = template.labourMin ?? 0;
  const fillCost = template.fillCost ?? 0;
  if (!finite(fabric) || !finite(labourMin) || !finite(fillCost) || labourMin < 0 || fillCost < 0) {
    return undefined;
  }

  const labour = labourMin * labourRate(rates);
  const baseCost = fabric + labour + fillCost;
  const marginMultiplier = rates.marginMultiplier ?? 1;
  const marginFloor = rates.marginFloor ?? 0;
  if (
    !finite(labour) ||
    !finite(baseCost) ||
    !finite(marginMultiplier) ||
    marginMultiplier < 0 ||
    !finite(marginFloor)
  ) {
    return undefined;
  }

  const priceBeforeRounding = baseCost * marginMultiplier;
  if (!finite(priceBeforeRounding)) return undefined;
  const margin = priceBeforeRounding - baseCost;
  if (margin < marginFloor - EPSILON) return undefined;

  const ownerShareBeforeRounding =
    (fabric * getOwnerShareBps(remnant, rates)) / 10_000 + margin * getMarginSliceFraction(rates);
  const decimals = currencyDecimals(rates);
  return {
    price: roundCurrency(priceBeforeRounding, decimals),
    ownerShare: roundCurrency(ownerShareBeforeRounding, decimals),
  };
}

function makeOffer(
  remnant: Remnant,
  template: ProductTemplate,
  rates: OfferRates,
  space: { bounds: Rect; free: Rect[]; obstacles: Rect[] },
): Offer | undefined {
  const pieces = expandPieces(template);
  if (!pieces) return undefined;

  let free = space.free;
  const placement: Placement[] = [];
  let usedArea = 0;

  for (const piece of pieces) {
    const candidate = bestCandidate(piece, free, remnant);
    if (!candidate) return undefined;
    if (!validPlacement(candidate.rect, space.bounds, space.obstacles, placement)) return undefined;

    const placed: Placement = {
      x: candidate.rect.x,
      y: candidate.rect.y,
      w: candidate.rect.w,
      h: candidate.rect.h,
      rotated: candidate.rotated,
    };
    placement.push(placed);
    usedArea += area(candidate.rect);
    free = subtractPlacement(free, candidate.rect);
  }

  const pricing = priceOffer(remnant, template, normalizeNumber(usedArea), rates);
  if (!pricing) return undefined;
  return {
    templateId: templateId(template),
    placement,
    usedArea: normalizeNumber(usedArea),
    price: pricing.price,
    ownerShare: pricing.ownerShare,
  };
}

/**
 * Compute all currently feasible offers for a remnant.
 *
 * The input is never mutated. Defects and allocations are removed from the
 * free-space rectangles before each template is placed, and each template is
 * evaluated independently against that same snapshot. The returned order is
 * stable by template id, then name, then source position.
 */
export function computeOffers(
  remnant: Remnant,
  templates: readonly ProductTemplate[],
  rates: OfferRates = {},
): Offer[] {
  if (!remnant || !Array.isArray(templates)) return [];
  const space = freeSpace(remnant);
  if (!space || space.free.length === 0) return [];

  const orderedTemplates = templates
    .map((template, sourceIndex) => ({ template, sourceIndex }))
    .filter(({ template }) => Boolean(template) && template.active !== false)
    .sort((a, b) => {
      const idDifference = compareStrings(templateId(a.template), templateId(b.template));
      if (idDifference !== 0) return idDifference;
      const nameDifference = compareStrings(a.template.name, b.template.name);
      if (nameDifference !== 0) return nameDifference;
      return a.sourceIndex - b.sourceIndex;
    });

  const offers: Offer[] = [];
  for (const { template } of orderedTemplates) {
    const offer = makeOffer(remnant, template, rates, space);
    if (offer) offers.push(offer);
  }
  return offers;
}
