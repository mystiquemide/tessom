export const OFFER_REFERENCE_PATTERN = /^[0-9a-f]{16}$/;

export interface OfferStatus {
  reference: string;
  title: string;
  size: string;
  stage: "new" | "accepted" | "declined";
  headline: string;
  detail: string;
}

const COPY = {
  new: {
    headline: "Waiting for the workshop",
    detail: "The workshop reviews every offer before anything is listed. It will contact you at the email you gave.",
  },
  accepted: {
    headline: "Accepted",
    detail: "The workshop will send you a private link so you can approve the listing. Nothing goes on sale until you do.",
  },
  declined: {
    headline: "Not taken this time",
    detail: "The workshop couldn't use this fabric. Nothing was listed, and you can offer another piece.",
  },
} as const;

/**
 * What a submitter may see about their own offer. It carries no contact details, no photo
 * and no internal IDs. The 16-character reference is the only key, and it cannot be guessed.
 */
export function buildOfferStatus(
  reference: string,
  document: {_type?: string; status?: string; fabricName?: string; widthCm?: number; heightCm?: number} | null | undefined,
): OfferStatus | null {
  if (!OFFER_REFERENCE_PATTERN.test(reference) || !document || document._type !== "submission") return null;
  const stage = document.status === "accepted" || document.status === "declined" ? document.status : "new";
  return {
    reference,
    title: document.fabricName?.trim() || "Your fabric",
    size: `${document.widthCm ?? "?"} × ${document.heightCm ?? "?"} cm`,
    stage,
    ...COPY[stage],
  };
}
