import {createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual} from "node:crypto";
import type {PatchOperations} from "@sanity/client";

import type {Placement, ProductTemplate, Rect, Remnant} from "../offers";
import {
  createSanityServerClient,
  COMMERCE_STATE_DOCUMENT_ID,
  COMMERCE_STATE_TYPE,
  type SanityEnvironment,
  type SanityDocumentReadClient,
  type SanityPersistenceClient,
  type SanityReadClient,
} from "./client";

export const ORDER_CONTEXT_QUERY = `{
  "remnant": *[_type == "remnant" && _id == $remnantId][0]{
    _id,
    _rev,
    title,
    fabric{name, maker, valuePerM},
    widthCm,
    heightCm,
    repeat{vCm, hCm},
    directional,
    defects[]{x, y, w, h},
    allocations[]{x, y, w, h},
    "ownerShareBps": owner->shareBps,
    status
  },
  "templates": *[_type == "productTemplate" && active == true] | order(_id asc){
    _id,
    name,
    kind,
    pieces[]{label, wCm, hCm, qty, centerPattern},
    seamCm,
    labourMin,
    fillCost,
    active
  }
}`;

const REMNANT_STATUSES = new Set([
  "intake",
  "consented",
  "listed",
  "allocated",
  "sold-out",
  "returned",
]);

const SANITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REVISION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const ENCRYPTION_ALGORITHM = "aes-256-gcm" as const;
const ENCRYPTION_VERSION = 1 as const;
const ENCRYPTION_IV_BYTES = 12;
const ENCRYPTION_KEY_BYTES = 32;

type UnknownRecord = Record<string, unknown>;

export interface EncryptedBuyerContact {
  algorithm: typeof ENCRYPTION_ALGORITHM;
  version: typeof ENCRYPTION_VERSION;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface OrderReplayInput {
  orderId: string;
  remnantId: string;
  templateId: string;
  buyerName: string;
  buyerEmail: string;
  idempotencyKey?: string;
}

export interface OrderReplayResult {
  orderId: string;
  workflowInstanceId: string;
  remnantId: string;
  templateId: string;
  placement: Placement[];
  usedArea: number;
  price: number;
  ownerShare: number;
  createdAt: string;
}

export type OrderReplayOutcome =
  | ({status: "matched"} & OrderReplayResult)
  | {status: "missing"}
  | {status: "mismatch"};

export class SanityEncryptionConfigurationError extends Error {
  readonly code = "SANITY_ENCRYPTION_CONFIGURATION_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "SanityEncryptionConfigurationError";
  }
}

export interface OrderContextRemnant extends Remnant {
  _id: string;
  _rev: string;
  title: string;
  status: string;
  ownerShareBps: number;
}

export interface OrderContext {
  remnant: OrderContextRemnant;
  templates: ProductTemplate[];
}

export interface DirectCommitAllocatedOrderInput {
  /** Stable order document ID chosen by the caller. */
  orderId: string;
  remnantId: string;
  /** The revision returned by fetchOrderContext. */
  ifRevisionId: string;
  templateId: string;
  placement: readonly Placement[];
  price: number;
  ownerShare: number;
  buyerName: string;
  buyerEmail: string;
  /** Optional client key used to make retries of this request idempotent. */
  idempotencyKey?: string;
  workflowInstanceId: string;
  createdAt: string;
}

/**
 * Shape accepted from the order command layer. The command has already
 * recomputed the placement, and keeps the Sanity order document together with
 * the optimistic write inputs.
 */
export interface OrderCommandCommitInput {
  orderId: string;
  remnantId: string;
  ifRevisionId: string;
  templateId: string;
  placement: readonly Placement[];
  price: number;
  ownerShare: number;
  idempotencyKey?: string;
  order: {
    _id: string;
    _type: "order";
    remnant: {_type: "reference"; _ref: string};
    template: {_type: "reference"; _ref: string};
    placement: readonly Placement[];
    price: number;
    ownerShare: number;
    buyerName: string;
    buyerEmail: string;
    idempotencyKey?: string;
    workflowInstanceId: string;
    createdAt: string;
  };
}

export type CommitAllocatedOrderInput = DirectCommitAllocatedOrderInput | OrderCommandCommitInput;

export interface CommittedOrderSummary {
  orderId: string;
  remnantId: string;
  templateId: string;
  placement: Placement[];
  price: number;
  ownerShare: number;
  createdAt: string;
}

export class SanityDataValidationError extends Error {
  readonly code = "SANITY_DATA_VALIDATION_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "SanityDataValidationError";
  }
}

export class SanityRevisionConflictError extends Error {
  readonly code = "SANITY_REVISION_CONFLICT" as const;

  constructor(options?: {cause?: unknown}) {
    super("The remnant changed before the order could be allocated.", options);
    this.name = "SanityRevisionConflictError";
  }
}

export function isSanityRevisionConflict(error: unknown): error is SanityRevisionConflictError {
  return error instanceof SanityRevisionConflictError;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function encryptionConfigurationError(reason: "missing" | "invalid"): SanityEncryptionConfigurationError {
  if (reason === "missing") {
    return new SanityEncryptionConfigurationError("Missing required environment variable: ORDER_ENCRYPTION_KEY");
  }
  return new SanityEncryptionConfigurationError(
    "Server configuration is unavailable: Invalid ORDER_ENCRYPTION_KEY configuration",
  );
}

function encryptionKey(environment: SanityEnvironment = process.env): Buffer {
  const encoded = environment.ORDER_ENCRYPTION_KEY?.trim();
  if (!encoded) throw encryptionConfigurationError("missing");
  if (!BASE64_PATTERN.test(encoded)) throw encryptionConfigurationError("invalid");

  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length !== ENCRYPTION_KEY_BYTES || decoded.toString("base64") !== encoded) {
    throw encryptionConfigurationError("invalid");
  }
  return decoded;
}

export function normalizeBuyerName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

export function normalizeBuyerEmail(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function canonicalBuyerContactPayload(buyerName: string, buyerEmail: string): string {
  return JSON.stringify({
    buyerName: normalizeBuyerName(buyerName),
    buyerEmail: normalizeBuyerEmail(buyerEmail),
  });
}

export function canonicalOrderRequestIdentity(input: {
  remnantId: string;
  templateId: string;
  buyerName: string;
  buyerEmail: string;
  idempotencyKey?: string;
  orderId?: string;
}): string {
  const identityKey = input.idempotencyKey ?? input.orderId;
  if (!identityKey) {
    throw new SanityDataValidationError("Invalid order idempotency identity");
  }
  return JSON.stringify({
    remnantId: input.remnantId,
    templateId: input.templateId,
    buyerName: normalizeBuyerName(input.buyerName),
    buyerEmail: normalizeBuyerEmail(input.buyerEmail),
    idempotencyKey: identityKey,
  });
}

export function createOrderRequestFingerprint(input: {
  remnantId: string;
  templateId: string;
  buyerName: string;
  buyerEmail: string;
  idempotencyKey?: string;
  orderId?: string;
}, environment: SanityEnvironment = process.env): string {
  const key = encryptionKey(environment);
  return createHmac("sha256", key)
    .update(canonicalOrderRequestIdentity(input), "utf8")
    .digest("hex");
}

function base64(value: Buffer): string {
  return value.toString("base64");
}

function parseBase64(value: unknown, field: string): Buffer {
  const encoded = stringValue(value, field);
  if (!BASE64_PATTERN.test(encoded)) {
    throw new SanityDataValidationError(`Invalid Sanity value for ${field}`);
  }
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.toString("base64") !== encoded) {
    throw new SanityDataValidationError(`Invalid Sanity value for ${field}`);
  }
  return decoded;
}

function validateEncryptedBuyerContact(value: unknown, field = "buyerContact"): EncryptedBuyerContact {
  if (!isRecord(value)) throw new SanityDataValidationError(`Invalid Sanity value for ${field}`);
  if ("buyerName" in value || "buyerEmail" in value) {
    throw new SanityDataValidationError(`Invalid Sanity value for ${field}`);
  }
  if (value.algorithm !== ENCRYPTION_ALGORITHM || value.version !== ENCRYPTION_VERSION) {
    throw new SanityDataValidationError(`Invalid Sanity value for ${field}`);
  }
  const iv = parseBase64(value.iv, `${field}.iv`);
  const authTag = parseBase64(value.authTag, `${field}.authTag`);
  const ciphertext = parseBase64(value.ciphertext, `${field}.ciphertext`);
  if (iv.length !== ENCRYPTION_IV_BYTES || authTag.length !== 16 || ciphertext.length === 0) {
    throw new SanityDataValidationError(`Invalid Sanity value for ${field}`);
  }
  return {
    algorithm: ENCRYPTION_ALGORITHM,
    version: ENCRYPTION_VERSION,
    iv: base64(iv),
    authTag: base64(authTag),
    ciphertext: base64(ciphertext),
  };
}

export function encryptBuyerContact(
  buyerName: string,
  buyerEmail: string,
  environment: SanityEnvironment = process.env,
): EncryptedBuyerContact {
  const key = encryptionKey(environment);
  const iv = randomBytes(ENCRYPTION_IV_BYTES);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(canonicalBuyerContactPayload(buyerName, buyerEmail), "utf8"),
    cipher.final(),
  ]);
  return {
    algorithm: ENCRYPTION_ALGORITHM,
    version: ENCRYPTION_VERSION,
    iv: base64(iv),
    authTag: base64(cipher.getAuthTag()),
    ciphertext: base64(ciphertext),
  };
}

/** Server-only helper for controlled decryption tests and operational tooling. */
export function decryptBuyerContact(
  value: unknown,
  environment: SanityEnvironment = process.env,
): {buyerName: string; buyerEmail: string} {
  const encrypted = validateEncryptedBuyerContact(value);
  const key = encryptionKey(environment);
  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    key,
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  let plaintext: string;
  try {
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SanityDataValidationError("Unable to decrypt buyer contact");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new SanityDataValidationError("Invalid encrypted buyer contact");
  }
  if (!isRecord(parsed)) throw new SanityDataValidationError("Invalid encrypted buyer contact");
  const buyerName = stringValue(parsed.buyerName, "buyerName", {maxLength: 160});
  const buyerEmail = stringValue(parsed.buyerEmail, "buyerEmail", {maxLength: 320});
  if (!EMAIL_PATTERN.test(buyerEmail)) throw new SanityDataValidationError("Invalid encrypted buyer contact");
  return {buyerName, buyerEmail};
}

export const decryptBuyerContactForTest = decryptBuyerContact;

function stringValue(value: unknown, field: string, options: {maxLength?: number} = {}): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SanityDataValidationError(`Invalid Sanity value for ${field}`);
  }
  const normalized = value.trim();
  if (options.maxLength !== undefined && normalized.length > options.maxLength) {
    throw new SanityDataValidationError(`Invalid Sanity value for ${field}`);
  }
  return normalized;
}

function documentId(value: unknown, field: string): string {
  const normalized = stringValue(value, field);
  if (!SANITY_ID_PATTERN.test(normalized)) {
    throw new SanityDataValidationError(`Invalid Sanity value for ${field}`);
  }
  return normalized;
}

function revisionId(value: unknown, field: string): string {
  const normalized = stringValue(value, field);
  if (!REVISION_ID_PATTERN.test(normalized)) {
    throw new SanityDataValidationError(`Invalid Sanity value for ${field}`);
  }
  return normalized;
}

function finiteNumber(value: unknown, field: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new SanityDataValidationError(`Invalid Sanity value for ${field}`);
  }
  return value;
}

function optionalFiniteNumber(value: unknown, field: string, minimum: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  return finiteNumber(value, field, minimum);
}

function positiveInteger(value: unknown, field: string): number {
  const number = finiteNumber(value, field, 1);
  if (!Number.isInteger(number)) {
    throw new SanityDataValidationError(`Invalid Sanity value for ${field}`);
  }
  return number;
}

function rectangle(value: unknown, field: string): Rect {
  if (!isRecord(value)) {
    throw new SanityDataValidationError(`Invalid Sanity value for ${field}`);
  }
  return {
    x: finiteNumber(value.x, `${field}.x`, 0),
    y: finiteNumber(value.y, `${field}.y`, 0),
    w: finiteNumber(value.w, `${field}.w`, Number.MIN_VALUE),
    h: finiteNumber(value.h, `${field}.h`, Number.MIN_VALUE),
  };
}

function withinBounds(rect: Rect, width: number, height: number, field: string): Rect {
  if (rect.x + rect.w > width || rect.y + rect.h > height) {
    throw new SanityDataValidationError(`Invalid Sanity value for ${field}`);
  }
  return rect;
}

function parseRemnant(value: unknown): OrderContextRemnant {
  if (!isRecord(value)) {
    throw new SanityDataValidationError("Invalid Sanity remnant");
  }

  const id = documentId(value._id, "remnant._id");
  const rev = revisionId(value._rev, "remnant._rev");
  const title = stringValue(value.title, "remnant.title", {maxLength: 160});
  const widthCm = finiteNumber(value.widthCm, "remnant.widthCm", Number.MIN_VALUE);
  const heightCm = finiteNumber(value.heightCm, "remnant.heightCm", Number.MIN_VALUE);
  const status = stringValue(value.status, "remnant.status");
  if (!REMNANT_STATUSES.has(status)) {
    throw new SanityDataValidationError("Invalid Sanity value for remnant.status");
  }
  if (typeof value.directional !== "boolean") {
    throw new SanityDataValidationError("Invalid Sanity value for remnant.directional");
  }

  if (!isRecord(value.fabric)) {
    throw new SanityDataValidationError("Invalid Sanity value for remnant.fabric");
  }
  const fabricName = stringValue(value.fabric.name, "remnant.fabric.name", {maxLength: 160});
  const fabricMaker = stringValue(value.fabric.maker, "remnant.fabric.maker", {maxLength: 160});
  const valuePerM = finiteNumber(value.fabric.valuePerM, "remnant.fabric.valuePerM", Number.MIN_VALUE);

  let patternRepeat: Remnant["repeat"] = null;
  if (value.repeat !== undefined && value.repeat !== null) {
    if (!isRecord(value.repeat)) {
      throw new SanityDataValidationError("Invalid Sanity value for remnant.repeat");
    }
    patternRepeat = {
      vCm: optionalFiniteNumber(value.repeat.vCm, "remnant.repeat.vCm", Number.MIN_VALUE),
      hCm: optionalFiniteNumber(value.repeat.hCm, "remnant.repeat.hCm", Number.MIN_VALUE),
    };
  }

  const rawDefects = value.defects === undefined || value.defects === null ? [] : value.defects;
  const rawAllocations = value.allocations === undefined || value.allocations === null ? [] : value.allocations;
  if (!Array.isArray(rawDefects) || !Array.isArray(rawAllocations)) {
    throw new SanityDataValidationError("Invalid Sanity value for remnant rectangles");
  }
  const defects = rawDefects.map((item, index) => withinBounds(rectangle(item, `remnant.defects[${index}]`), widthCm, heightCm, `remnant.defects[${index}]`));
  const allocations = rawAllocations.map((item, index) => withinBounds(rectangle(item, `remnant.allocations[${index}]`), widthCm, heightCm, `remnant.allocations[${index}]`));
  const ownerShareBps = finiteNumber(value.ownerShareBps, "remnant.ownerShareBps", 0);
  if (!Number.isInteger(ownerShareBps) || ownerShareBps > 10_000) {
    throw new SanityDataValidationError("Invalid Sanity value for remnant.ownerShareBps");
  }

  return {
    _id: id,
    _rev: rev,
    title,
    widthCm,
    heightCm,
    fabric: {name: fabricName, maker: fabricMaker, valuePerM},
    repeat: patternRepeat,
    directional: value.directional,
    defects,
    allocations,
    ownerShareBps,
    status,
  };
}

function parseTemplatePiece(value: unknown, field: string): ProductTemplate["pieces"][number] {
  if (!isRecord(value)) {
    throw new SanityDataValidationError(`Invalid Sanity value for ${field}`);
  }
  const piece: ProductTemplate["pieces"][number] = {
    label: stringValue(value.label, `${field}.label`, {maxLength: 80}),
    wCm: finiteNumber(value.wCm, `${field}.wCm`, Number.MIN_VALUE),
    hCm: finiteNumber(value.hCm, `${field}.hCm`, Number.MIN_VALUE),
    centerPattern: value.centerPattern === true,
  };
  if (value.qty !== undefined && value.qty !== null) {
    piece.qty = positiveInteger(value.qty, `${field}.qty`);
  }
  if (typeof value.centerPattern !== "boolean") {
    throw new SanityDataValidationError(`Invalid Sanity value for ${field}.centerPattern`);
  }
  return piece;
}

function parseTemplates(value: unknown): ProductTemplate[] {
  if (!Array.isArray(value)) {
    throw new SanityDataValidationError("Invalid Sanity product templates");
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new SanityDataValidationError(`Invalid Sanity value for templates[${index}]`);
    }
    const id = documentId(item._id, `templates[${index}]._id`);
    const name = stringValue(item.name, `templates[${index}].name`, {maxLength: 160});
    if (item.active !== true) {
      throw new SanityDataValidationError(`Invalid Sanity value for templates[${index}].active`);
    }
    if (!Array.isArray(item.pieces) || item.pieces.length === 0) {
      throw new SanityDataValidationError(`Invalid Sanity value for templates[${index}].pieces`);
    }
    const template: ProductTemplate = {
      _id: id,
      name,
      pieces: item.pieces.map((piece, pieceIndex) =>
        parseTemplatePiece(piece, `templates[${index}].pieces[${pieceIndex}]`),
      ),
      active: true,
    };
    if (item.kind !== undefined && item.kind !== null) {
      template.kind = stringValue(item.kind, `templates[${index}].kind`);
    }
    template.seamCm = optionalFiniteNumber(item.seamCm, `templates[${index}].seamCm`, 0);
    template.labourMin = optionalFiniteNumber(item.labourMin, `templates[${index}].labourMin`, 0);
    if (template.labourMin !== undefined && !Number.isInteger(template.labourMin)) {
      throw new SanityDataValidationError(`Invalid Sanity value for templates[${index}].labourMin`);
    }
    template.fillCost = optionalFiniteNumber(item.fillCost, `templates[${index}].fillCost`, 0);
    return template;
  });
}

export async function fetchOrderContext(
  remnantId: string,
  client?: SanityReadClient,
): Promise<OrderContext | null> {
  const id = documentId(remnantId, "remnantId");
  const activeClient = client ?? createSanityServerClient();
  const result = await activeClient.fetch<unknown>(ORDER_CONTEXT_QUERY, {remnantId: id});
  if (!isRecord(result) || result.remnant === null || result.remnant === undefined) {
    return null;
  }
  return {
    remnant: parseRemnant(result.remnant),
    templates: parseTemplates(result.templates),
  };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function validatePlacement(value: unknown, index: number): Placement {
  if (!isRecord(value)) {
    throw new SanityDataValidationError(`Invalid order placement at index ${index}`);
  }
  if (typeof value.rotated !== "boolean") {
    throw new SanityDataValidationError(`Invalid order placement at index ${index}`);
  }
  return {
    x: finiteNumber(value.x, `placement[${index}].x`, 0),
    y: finiteNumber(value.y, `placement[${index}].y`, 0),
    w: finiteNumber(value.w, `placement[${index}].w`, Number.MIN_VALUE),
    h: finiteNumber(value.h, `placement[${index}].h`, Number.MIN_VALUE),
    rotated: value.rotated,
  };
}

function allocationKey(orderId: string, index: number): string {
  const candidate = `allocation-${orderId}-${index + 1}`;
  if (candidate.length <= 128) return candidate;
  let hash = 2166136261;
  for (const character of orderId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `allocation-${(hash >>> 0).toString(36)}-${index + 1}`;
}

function validateCommitInput(
  input: CommitAllocatedOrderInput,
  environment: SanityEnvironment = process.env,
): {
  orderId: string;
  remnantId: string;
  ifRevisionId: string;
  templateId: string;
  placement: Placement[];
  price: number;
  ownerShare: number;
  buyerName: string;
  buyerEmail: string;
  idempotencyKey?: string;
  buyerContact: EncryptedBuyerContact;
  requestFingerprint: string;
  workflowInstanceId: string;
  createdAt: string;
} {
  if (!isRecord(input)) {
    throw new SanityDataValidationError("Invalid order input");
  }
  const commandOrder = isRecord(input.order) ? input.order : undefined;
  if (commandOrder) {
    const commandOrderId = documentId(commandOrder._id, "order._id");
    if (commandOrderId !== input.orderId) {
      throw new SanityDataValidationError("Invalid order reference");
    }
    if (
      !isRecord(commandOrder.remnant) ||
      commandOrder.remnant._ref !== input.remnantId ||
      !isRecord(commandOrder.template) ||
      commandOrder.template._ref !== input.templateId
    ) {
      throw new SanityDataValidationError("Invalid order reference");
    }
  }
  const orderId = documentId(input.orderId, "orderId");
  const remnantId = documentId(input.remnantId, "remnantId");
  const ifRevisionId = revisionId(input.ifRevisionId, "ifRevisionId");
  const templateId = documentId(input.templateId, "templateId");
  if (!Array.isArray(input.placement) || input.placement.length === 0) {
    throw new SanityDataValidationError("Invalid order placement");
  }
  const placement = input.placement.map(validatePlacement);
  for (let first = 0; first < placement.length; first += 1) {
    for (let second = first + 1; second < placement.length; second += 1) {
      if (intersects(placement[first], placement[second])) {
        throw new SanityDataValidationError("Invalid order placement");
      }
    }
  }
  const price = finiteNumber(input.price, "price", Number.MIN_VALUE);
  const ownerShare = finiteNumber(input.ownerShare, "ownerShare", 0);
  const buyerName = stringValue(commandOrder?.buyerName ?? input.buyerName, "buyerName", {maxLength: 160});
  const buyerEmail = stringValue(commandOrder?.buyerEmail ?? input.buyerEmail, "buyerEmail", {maxLength: 320});
  if (!EMAIL_PATTERN.test(buyerEmail)) {
    throw new SanityDataValidationError("Invalid order buyerEmail");
  }
  if (
    commandOrder?.idempotencyKey !== undefined &&
    input.idempotencyKey !== undefined &&
    commandOrder.idempotencyKey !== input.idempotencyKey
  ) {
    throw new SanityDataValidationError("Invalid order idempotency identity");
  }
  const rawIdempotencyKey = commandOrder?.idempotencyKey ?? input.idempotencyKey;
  const idempotencyKey = rawIdempotencyKey === undefined
    ? undefined
    : stringValue(rawIdempotencyKey, "idempotencyKey", {maxLength: 200});
  const workflowInstanceId = stringValue(
    commandOrder?.workflowInstanceId ?? input.workflowInstanceId,
    "workflowInstanceId",
    {maxLength: 240},
  );
  const createdAt = stringValue(commandOrder?.createdAt ?? input.createdAt, "createdAt", {maxLength: 80});
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new SanityDataValidationError("Invalid order createdAt");
  }
  const buyerContact = encryptBuyerContact(buyerName, buyerEmail, environment);
  const requestFingerprint = createOrderRequestFingerprint(
    {
      orderId,
      remnantId,
      templateId,
      buyerName,
      buyerEmail,
      idempotencyKey,
    },
    environment,
  );
  return {
    orderId,
    remnantId,
    ifRevisionId,
    templateId,
    placement,
    price,
    ownerShare,
    buyerName,
    buyerEmail,
    idempotencyKey,
    buyerContact,
    requestFingerprint,
    workflowInstanceId,
    createdAt,
  };
}

function isRevisionConflictLike(error: unknown, seen = new Set<unknown>()): boolean {
  if (!isRecord(error) || seen.has(error)) return false;
  seen.add(error);
  const codeValues = [error.code, error.type, error.errorType, error.statusCode, error.status];
  if (codeValues.some((value) => typeof value === "string" && /revision.?mismatch|if.?revision|transaction.?conflict|conflict/i.test(value))) {
    return true;
  }
  const status = error.statusCode ?? error.status;
  const messageValues = [error.message, error.description, error.error];
  const messageSuggestsRevisionConflict = messageValues.some(
    (value) => typeof value === "string" && /revision|if.?revision|stale|document changed|transaction was aborted/i.test(value),
  );
  if (messageSuggestsRevisionConflict) return true;
  const messageSuggestsGenericConflict = messageValues.some(
    (value) => typeof value === "string" && /conflict|transaction.*abort/i.test(value),
  );
  if ((status === 409 || status === "409") && messageSuggestsGenericConflict) return true;
  return Object.values(error).some((value) => isRevisionConflictLike(value, seen));
}

export function normalizeSanityRevisionConflict(error: unknown): unknown {
  if (isSanityRevisionConflict(error)) return error;
  return isRevisionConflictLike(error) ? new SanityRevisionConflictError({cause: error}) : error;
}

function orderDocument(input: ReturnType<typeof validateCommitInput>): Record<string, unknown> {
  return {
    _id: input.orderId,
    _type: "order",
    remnant: {_type: "reference", _ref: input.remnantId},
    template: {_type: "reference", _ref: input.templateId},
    placement: input.placement.map((piece, index) => ({
      _key: `placement-${index + 1}`,
      _type: "placement",
      ...piece,
    })),
    price: input.price,
    ownerShare: input.ownerShare,
    buyerContact: input.buyerContact,
    requestFingerprint: input.requestFingerprint,
    workflowInstanceId: input.workflowInstanceId,
    createdAt: input.createdAt,
  };
}

function allocationDocuments(input: ReturnType<typeof validateCommitInput>): Record<string, unknown>[] {
  return input.placement.map((piece, index) => ({
    _key: allocationKey(input.orderId, index),
    _type: "allocation",
    x: piece.x,
    y: piece.y,
    w: piece.w,
    h: piece.h,
    order: {_type: "reference", _ref: input.orderId},
  }));
}

export async function commitAllocatedOrder(
  input: CommitAllocatedOrderInput,
  client?: SanityPersistenceClient,
  environment: SanityEnvironment = process.env,
): Promise<CommittedOrderSummary> {
  const validated = validateCommitInput(input, environment);
  const activeClient = client ?? createSanityServerClient();
  const transaction = activeClient.transaction();
  const sentinelTimestamp = new Date().toISOString();
  if (!transaction.createIfNotExists) {
    throw new Error("Sanity transaction does not support createIfNotExists");
  }
  transaction.createIfNotExists({
    _id: COMMERCE_STATE_DOCUMENT_ID,
    _type: COMMERCE_STATE_TYPE,
    liveCommerce: true,
    createdAt: sentinelTimestamp,
    updatedAt: sentinelTimestamp,
  });
  transaction.patch(COMMERCE_STATE_DOCUMENT_ID, {
    set: {liveCommerce: true, updatedAt: sentinelTimestamp},
  });
  transaction.create(orderDocument(validated));
  const patch: PatchOperations = {
    ifRevisionID: validated.ifRevisionId,
    setIfMissing: {allocations: []},
    insert: {after: "allocations[-1]", items: allocationDocuments(validated)},
    set: {status: "allocated"},
  };
  transaction.patch(validated.remnantId, patch);

  try {
    await transaction.commit();
  } catch (error: unknown) {
    throw normalizeSanityRevisionConflict(error);
  }

  return {
    orderId: validated.orderId,
    remnantId: validated.remnantId,
    templateId: validated.templateId,
    placement: validated.placement,
    price: validated.price,
    ownerShare: validated.ownerShare,
    createdAt: validated.createdAt,
  };
}

function validatedReplayInput(input: OrderReplayInput): {
  orderId: string;
  remnantId: string;
  templateId: string;
  buyerName: string;
  buyerEmail: string;
  idempotencyKey?: string;
} {
  if (!isRecord(input)) throw new SanityDataValidationError("Invalid order replay input");
  const orderId = documentId(input.orderId, "orderId");
  const remnantId = documentId(input.remnantId, "remnantId");
  const templateId = documentId(input.templateId, "templateId");
  const buyerName = stringValue(input.buyerName, "buyerName", {maxLength: 160});
  const buyerEmail = stringValue(input.buyerEmail, "buyerEmail", {maxLength: 320});
  if (!EMAIL_PATTERN.test(buyerEmail)) throw new SanityDataValidationError("Invalid order buyerEmail");
  const idempotencyKey = input.idempotencyKey === undefined
    ? undefined
    : stringValue(input.idempotencyKey, "idempotencyKey", {maxLength: 200});
  return {orderId, remnantId, templateId, buyerName, buyerEmail, idempotencyKey};
}

function safeEqualFingerprint(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function projectedReference(value: unknown, alias: string, referenceField: string): string {
  if (value === undefined || value === null) {
    throw new SanityDataValidationError(`Invalid Sanity value for ${alias}`);
  }
  if (!isRecord(value)) throw new SanityDataValidationError(`Invalid Sanity value for ${alias}`);
  if (value._type !== "reference") {
    throw new SanityDataValidationError(`Invalid Sanity value for ${alias}`);
  }
  return documentId(value._ref, `${referenceField}._ref`);
}

function parseOrderReplayProjection(value: unknown, expectedOrderId: string): OrderReplayResult & {
  requestFingerprint: string;
} {
  if (!isRecord(value)) throw new SanityDataValidationError("Invalid Sanity order projection");
  if (value._type !== "order") {
    throw new SanityDataValidationError("Invalid Sanity order projection");
  }
  if ("buyerName" in value || "buyerEmail" in value) {
    throw new SanityDataValidationError("Invalid Sanity order projection");
  }
  const orderId = documentId(value._id, "order._id");
  if (orderId !== expectedOrderId) throw new SanityDataValidationError("Invalid Sanity order projection");

  const remnantId = projectedReference(value.remnant, "order.remnant", "order.remnant");
  const templateId = projectedReference(value.template, "order.template", "order.template");
  if (!Array.isArray(value.placement) || value.placement.length === 0) {
    throw new SanityDataValidationError("Invalid Sanity order placement projection");
  }
  const placement = value.placement.map(validatePlacement);
  for (let first = 0; first < placement.length; first += 1) {
    for (let second = first + 1; second < placement.length; second += 1) {
      if (intersects(placement[first], placement[second])) {
        throw new SanityDataValidationError("Invalid Sanity order placement projection");
      }
    }
  }
  const price = finiteNumber(value.price, "order.price", Number.MIN_VALUE);
  const ownerShare = finiteNumber(value.ownerShare, "order.ownerShare", 0);
  const workflowInstanceId = stringValue(value.workflowInstanceId, "order.workflowInstanceId", {maxLength: 240});
  const createdAt = stringValue(value.createdAt, "order.createdAt", {maxLength: 80});
  if (!Number.isFinite(Date.parse(createdAt))) throw new SanityDataValidationError("Invalid Sanity order.createdAt");
  const requestFingerprint = stringValue(value.requestFingerprint, "order.requestFingerprint", {maxLength: 128});
  if (!FINGERPRINT_PATTERN.test(requestFingerprint)) {
    throw new SanityDataValidationError("Invalid Sanity order.requestFingerprint");
  }
  validateEncryptedBuyerContact(value.buyerContact);
  const usedArea = placement.reduce((sum, piece) => sum + piece.w * piece.h, 0);
  if (!Number.isFinite(usedArea) || usedArea <= 0) {
    throw new SanityDataValidationError("Invalid Sanity order placement projection");
  }
  return {
    orderId,
    workflowInstanceId,
    remnantId,
    templateId,
    placement,
    usedArea,
    price,
    ownerShare,
    createdAt,
    requestFingerprint,
  };
}

export async function hasCommittedOrder(
  orderId: string,
  client?: SanityDocumentReadClient,
): Promise<boolean> {
  const id = documentId(orderId, "orderId");
  const activeClient = client ?? createSanityServerClient();
  const document = await activeClient.getDocument<UnknownRecord>(id);
  if (document === null || document === undefined) return false;
  if (!isRecord(document) || document._type !== "order") {
    throw new SanityDataValidationError("Invalid Sanity order existence projection");
  }
  const projectedId = documentId(document._id, "order._id");
  if (projectedId !== id) throw new SanityDataValidationError("Invalid Sanity order existence projection");
  return true;
}

export async function fetchOrderReplay(
  input: OrderReplayInput,
  client?: SanityDocumentReadClient,
  environment: SanityEnvironment = process.env,
): Promise<OrderReplayOutcome> {
  const validated = validatedReplayInput(input);
  const expectedFingerprint = createOrderRequestFingerprint(validated, environment);
  const activeClient = client ?? createSanityServerClient();
  const document = await activeClient.getDocument<UnknownRecord>(validated.orderId);
  if (document === null || document === undefined) return {status: "missing"};

  const parsed = parseOrderReplayProjection(document, validated.orderId);
  if (parsed.remnantId !== validated.remnantId || parsed.templateId !== validated.templateId) {
    return {status: "mismatch"};
  }
  if (!safeEqualFingerprint(expectedFingerprint, parsed.requestFingerprint)) {
    return {status: "mismatch"};
  }
  const result: OrderReplayResult = {
    orderId: parsed.orderId,
    workflowInstanceId: parsed.workflowInstanceId,
    remnantId: parsed.remnantId,
    templateId: parsed.templateId,
    placement: parsed.placement,
    usedArea: parsed.usedArea,
    price: parsed.price,
    ownerShare: parsed.ownerShare,
    createdAt: parsed.createdAt,
  };
  return {status: "matched", ...result};
}
