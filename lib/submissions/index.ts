import {randomBytes} from "node:crypto";

import {z} from "zod";

export const SUBMISSION_ID_PREFIX = "submissions.";
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
/** Vercel functions reject bodies over 4.5 MB, so the whole form stays under it. */
export const MAX_FORM_BYTES = 3 * 1024 * 1024 + 64 * 1024;
export const SUBMISSION_KINDS = ["client", "designer", "workshop"] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (max: number) => z.string().trim().max(max);
const dimension = z.coerce.number().finite().min(20).max(600);

export const submissionFieldsSchema = z
  .object({
    name: text(160).min(1),
    email: text(320).regex(EMAIL_PATTERN),
    kind: z.enum(SUBMISSION_KINDS),
    fabricName: text(160).optional().default(""),
    maker: text(160).optional().default(""),
    widthCm: dimension,
    heightCm: dimension,
    directional: z.enum(["true", "false"]).optional().default("false").transform((value) => value === "true"),
    notes: text(1000).optional().default(""),
    /** Honeypot. Real people leave it empty. */
    website: z.string().optional().default(""),
  })
  .strict();

export type SubmissionFields = z.infer<typeof submissionFieldsSchema>;

export type PhotoType = {contentType: "image/jpeg" | "image/png" | "image/webp"; extension: "jpg" | "png" | "webp"};

/** Decide the type from the file's own bytes. The browser-supplied type is never trusted. */
export function detectPhotoType(bytes: Uint8Array): PhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return {contentType: "image/jpeg", extension: "jpg"};
  }
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) {
    return {contentType: "image/png", extension: "png"};
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return {contentType: "image/webp", extension: "webp"};
  }
  return null;
}

export function newSubmissionId(): string {
  return `${SUBMISSION_ID_PREFIX}${randomBytes(8).toString("hex")}`;
}

export function publicSubmissionReference(id: string): string {
  return id.startsWith(SUBMISSION_ID_PREFIX) ? id.slice(SUBMISSION_ID_PREFIX.length) : id;
}

export function buildSubmissionDocument(input: {
  id: string;
  fields: SubmissionFields;
  contact: unknown;
  photoAssetId: string;
  now: Date;
}): Record<string, unknown> {
  const {fields} = input;
  return {
    _id: input.id,
    _type: "submission",
    status: "new",
    kind: fields.kind,
    fabricName: fields.fabricName,
    maker: fields.maker,
    widthCm: fields.widthCm,
    heightCm: fields.heightCm,
    directional: fields.directional,
    notes: fields.notes,
    photo: {_type: "image", asset: {_type: "reference", _ref: input.photoAssetId}},
    contact: input.contact,
    createdAt: input.now.toISOString(),
  };
}
