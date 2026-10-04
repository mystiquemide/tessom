import {sanityImageUrl, type SanityImageSource} from "../sanity/image";
import {decryptBuyerContact} from "../sanity/orders";
import {publicSubmissionReference, SUBMISSION_ID_PREFIX} from "./index";

export const SUBMISSION_REVIEW_ID_PATTERN = /^submissions\.[0-9a-f]{16}$/;

export const SUBMISSIONS_QUERY = `*[_type == "submission" && status == "new"] | order(createdAt asc){
  _id, kind, fabricName, maker, widthCm, heightCm, directional, notes, photo, contact, createdAt
}`;

export interface RawSubmission {
  _id: string;
  _rev?: string;
  kind?: string;
  fabricName?: string;
  maker?: string;
  widthCm?: number;
  heightCm?: number;
  directional?: boolean;
  notes?: string;
  photo?: (SanityImageSource & {asset?: {_ref?: string}}) | null;
  contact?: unknown;
  createdAt?: string;
}

export interface SubmissionCard {
  id: string;
  reference: string;
  title: string;
  details: string[];
  notes: string;
  photoUrl: string | null;
  /** First name only. The full contact opens only when the workshop accepts. */
  firstName: string;
}

function firstNameOf(contact: unknown): string {
  try {
    return decryptBuyerContact(contact).buyerName.split(/\s+/)[0] ?? "Someone";
  } catch {
    return "Someone";
  }
}

export function buildSubmissionCards(raw: readonly RawSubmission[]): SubmissionCard[] {
  return raw
    .filter((item) => SUBMISSION_REVIEW_ID_PATTERN.test(item._id))
    .map((item) => ({
      id: item._id,
      reference: publicSubmissionReference(item._id),
      title: item.fabricName?.trim() || "Unnamed fabric",
      details: [
        `${item.widthCm ?? "?"} × ${item.heightCm ?? "?"} cm`,
        item.directional ? "directional" : "no direction",
        item.kind ?? "unknown",
        item.maker?.trim() ? `by ${item.maker.trim()}` : "maker unknown",
      ],
      notes: item.notes?.trim() ?? "",
      photoUrl: sanityImageUrl(item.photo, 240),
      firstName: firstNameOf(item.contact),
    }));
}

const KIND_LABEL: Record<string, string> = {client: "Client", designer: "Designer", workshop: "Workshop"};

/**
 * The owner is a pseudonym ("Client 3fa9") so the submitter's real name never lands in the public dataset.
 * Their real contact stays encrypted on the private submission. The workshop can rename in Studio.
 */
export function buildAcceptDocuments(
  submission: RawSubmission,
  valuePerM: number,
): {ownerId: string; remnantId: string; owner: Record<string, unknown>; remnant: Record<string, unknown>} {
  const reference = publicSubmissionReference(submission._id);
  const ownerId = `owner-${reference}`;
  const remnantId = `remnant-${reference}`;
  const kind = submission.kind && submission.kind in KIND_LABEL ? submission.kind : "client";
  const assetRef = submission.photo?.asset?._ref;
  return {
    ownerId,
    remnantId,
    owner: {
      _id: ownerId,
      _type: "owner",
      name: `${KIND_LABEL[kind]} ${reference.slice(0, 4)}`,
      email: `${reference}@submissions.invalid`,
      kind,
      shareBps: 2000,
    },
    remnant: {
      _id: remnantId,
      _type: "remnant",
      title: submission.fabricName?.trim() || "Offered fabric",
      fabric: {
        _type: "fabric",
        name: submission.fabricName?.trim() || "Unnamed fabric",
        maker: submission.maker?.trim() || "Unknown maker",
        valuePerM,
      },
      widthCm: submission.widthCm,
      heightCm: submission.heightCm,
      directional: submission.directional === true,
      defects: [],
      ...(assetRef ? {photo: {_type: "image", asset: {_type: "reference", _ref: assetRef}}} : {}),
      owner: {_type: "reference", _ref: ownerId},
      status: "intake",
      allocations: [],
    },
  };
}

export const SUBMISSION_PREFIX = SUBMISSION_ID_PREFIX;
