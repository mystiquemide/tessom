import type {OfferRates} from "./index";

/**
 * Rates used by server offer reads and writes. These values stay in code so a
 * caller cannot change a price by sending configuration through an API route.
 */
export const DEFAULT_OFFER_RATES = {
  labourPerMinute: 1.25,
  marginMultiplier: 1.35,
  marginFloor: 5,
  ownerMarginSliceBps: 1_000,
  currencyDecimals: 2,
} satisfies Required<
  Pick<OfferRates, "labourPerMinute" | "marginMultiplier" | "marginFloor" | "ownerMarginSliceBps" | "currencyDecimals">
>;
