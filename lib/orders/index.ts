import { z } from "zod";

import {
  computeOffers,
  type Offer,
  type OfferRates,
  type Placement,
  type ProductTemplate,
  type Remnant,
} from "../offers";

/**
 * The order endpoint accepts identifiers and buyer details only. Geometry,
 * prices, and owner share are intentionally absent from this schema. A route
 * can pass an offer fingerprint returned by the server to detect a stale
 * offer before it is committed.
 */
export const orderRequestSchema = z
  .object({
    remnantId: z.string().trim().min(1).max(200),
    templateId: z.string().trim().min(1).max(200),
    buyerName: z.string().trim().min(1).max(160),
    buyerEmail: z.string().trim().email().max(320),
    offerFingerprint: z.string().trim().min(1).max(256).optional(),
    /** A client supplied key makes retries of the same checkout idempotent. */
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export type OrderRequest = z.infer<typeof orderRequestSchema>;

export type RemnantStatus =
  | "intake"
  | "consented"
  | "listed"
  | "allocated"
  | "sold-out"
  | "returned"
  | (string & {});

/** The server-side remnant projection needed by the order command. */
export interface OrderRemnant extends Remnant {
  _id?: string;
  _rev?: string;
  status?: RemnantStatus;
}

export interface OrderContext {
  remnant: OrderRemnant;
  templates: readonly ProductTemplate[];
}

export interface SanityReference {
  _type: "reference";
  _ref: string;
}

export interface OrderDocumentInput {
  _id: string;
  _type: "order";
  remnant: SanityReference;
  template: SanityReference;
  placement: Placement[];
  price: number;
  ownerShare: number;
  buyerName: string;
  buyerEmail: string;
  workflowInstanceId: string;
  createdAt: string;
}

export interface AllocationInput extends Placement {
  order: SanityReference;
}

/**
 * Semantic input for the persistence adapter. The adapter turns this into a
 * Sanity transaction or another optimistic write. `ifRevisionId` is repeated
 * explicitly because it is the name used by Sanity's optimistic patch API.
 */
export interface OrderCommitInput {
  orderId: string;
  remnantId: string;
  templateId: string;
  /** The explicit client key is used by persistence to protect request identity. */
  idempotencyKey?: string;
  expectedRevision: string;
  ifRevisionId: string;
  nextRemnantStatus: "allocated";
  placement: Placement[];
  usedArea: number;
  price: number;
  ownerShare: number;
  allocations: AllocationInput[];
  order: OrderDocumentInput;
}

export interface AllocateOrderInput {
  orderId: string;
  workflowInstanceId: string;
  remnantId: string;
  templateId: string;
  placement: Placement[];
  usedArea: number;
}

export interface PrepareWorkflowInput {
  orderId: string;
  remnantId: string;
  templateId: string;
  /** A fresh secure workflow instance is used for every order attempt. */
  workflowInstanceId: string;
  placement: Placement[];
  usedArea: number;
  price: number;
  ownerShare: number;
}

export interface PrepareWorkflowResult {
  /** The instance created by the lifecycle adapter and stored on the order. */
  workflowInstanceId: string;
}

export type CommitOrderResult =
  | void
  | false
  | {
      committed?: boolean;
      conflict?: boolean;
      /** An adapter may use this when it found an already committed idempotency key. */
      existing?: boolean;
      /** A reconciled committed order can be returned without re-running allocation. */
      replay?: OrderResult;
    };

export interface OrderReplayLookupInput {
  orderId: string;
  remnantId: string;
  templateId: string;
  buyerName: string;
  buyerEmail: string;
  idempotencyKey: string;
}

export type OrderReplayLookupResult =
  | ({status: "matched"} & OrderResult)
  | {status: "missing"}
  | {status: "mismatch"};

export type LoadOrderReplay = (
  input: OrderReplayLookupInput,
) => Promise<OrderReplayLookupResult | null | undefined>;

export interface OrderReplayRecoveryInput {
  orderId: string;
  workflowInstanceId: string;
}

/** Completes a persisted order's workflow before a keyed replay is returned. */
export type RecoverOrderReplay = (input: OrderReplayRecoveryInput) => Promise<void>;

export type LoadOrderContext = (remnantId: string) => Promise<OrderContext | null | undefined>;
export type CommitOrder = (input: OrderCommitInput) => Promise<CommitOrderResult>;
export type AllocateOrder = (input: AllocateOrderInput) => Promise<void>;
export type PrepareWorkflow = (input: PrepareWorkflowInput) => Promise<PrepareWorkflowResult>;

export interface OrderServiceDependencies {
  /** Loads a fresh remnant revision and its current templates for every command. */
  loadOrderContext?: LoadOrderContext;
  /** Alias useful to route adapters that call this operation simply `load`. */
  loadContext?: LoadOrderContext;
  /** Looks up an explicit-key order before any offer or workflow work. */
  loadOrderReplay?: LoadOrderReplay;
  /** Short alias for adapters that expose replay lookup as `loadReplay`. */
  loadReplay?: LoadOrderReplay;
  /** Ensures a matched persisted replay has completed workflow allocation. */
  recoverReplay?: RecoverOrderReplay;
  /** Alias useful to adapters that name this operation after the persisted order. */
  recoverOrderReplay?: RecoverOrderReplay;
  /** Commits the order and allocation with the supplied optimistic revision. */
  commitOrder?: CommitOrder;
  /** Alias for adapters that expose the operation as `persistOrder`. */
  persistOrder?: CommitOrder;
  /** Creates the guarded lifecycle instance before the Sanity allocation write. */
  prepareWorkflow?: PrepareWorkflow;
  workflow?: {
    prepare?: PrepareWorkflow;
    allocate: AllocateOrder;
  };
  /** Workflow action called only after a successful commit. */
  allocate?: AllocateOrder;
  /** These rates belong to the server and are never read from the request. */
  rates?: OfferRates | (() => OfferRates | Promise<OfferRates>);
  /** Deterministic injection point for tests and route-level configuration. */
  createOrderId?: (input: {
    request: OrderRequest;
    context: OrderContext;
    offer: Offer;
  }) => string;
  generateOrderId?: (input: {
    request: OrderRequest;
    context: OrderContext;
    offer: Offer;
  }) => string;
  /** Defaults to a fresh ISO timestamp. */
  now?: () => Date | string;
}

export type OrderErrorCode =
  | "BAD_REQUEST"
  | "UNAVAILABLE_OFFER"
  | "CONFLICT"
  | "WORKFLOW_FAILURE";

export abstract class OrderDomainError extends Error {
  abstract readonly code: OrderErrorCode;
  readonly httpStatus: 400 | 409 | 503;

  protected constructor(message: string, httpStatus: 400 | 409 | 503, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.httpStatus = httpStatus;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadOrderRequestError extends OrderDomainError {
  readonly code = "BAD_REQUEST" as const;
  readonly issues: z.ZodIssue[];

  constructor(issues: z.ZodIssue[] | string) {
    const normalized = typeof issues === "string" ? issues : "Order request failed validation";
    super(normalized, 400);
    this.issues = typeof issues === "string" ? [] : issues;
  }
}

export type UnavailableOfferReason =
  | "REMNANT_NOT_FOUND"
  | "REMNANT_NOT_LISTED"
  | "TEMPLATE_UNAVAILABLE"
  | "STALE_OFFER";

export class UnavailableOfferError extends OrderDomainError {
  readonly code = "UNAVAILABLE_OFFER" as const;
  readonly reason: UnavailableOfferReason;
  readonly remnantId: string;
  readonly templateId: string;

  constructor(
    reason: UnavailableOfferReason,
    values: { remnantId: string; templateId: string },
  ) {
    const messages: Record<UnavailableOfferReason, string> = {
      REMNANT_NOT_FOUND: "The remnant is no longer available",
      REMNANT_NOT_LISTED: "The remnant is not currently listed",
      TEMPLATE_UNAVAILABLE: "That product offer is no longer available",
      STALE_OFFER: "That offer has changed and must be selected again",
    };
    super(messages[reason], 409);
    this.reason = reason;
    this.remnantId = values.remnantId;
    this.templateId = values.templateId;
  }
}

export class OrderConflictError extends OrderDomainError {
  readonly code = "CONFLICT" as const;
  readonly orderId?: string;
  /**
   * Preparation happens before optimistic persistence, so a later conflict
   * has to reconcile the prepared lifecycle instance before this error is
   * returned. The ID remains available for deterministic reconciliation.
   */
  readonly orphanWorkflowInstanceId?: string;

  constructor(
    message = "The remnant changed while the order was being placed",
    orderId?: string,
    orphanWorkflowInstanceId?: string,
  ) {
    super(message, 409);
    this.orderId = orderId;
    this.orphanWorkflowInstanceId = orphanWorkflowInstanceId;
  }
}

export class WorkflowPreparationError extends OrderDomainError {
  readonly code = "WORKFLOW_FAILURE" as const;
  readonly phase = "prepare" as const;
  readonly committed = false as const;
  readonly retryable = true as const;

  constructor(cause?: unknown) {
    super("The lifecycle workflow could not be prepared", 503, {cause});
  }
}

/**
 * The Sanity allocation was rejected after workflow preparation, but the
 * prepared guard could not be neutralized. The caller must reconcile this
 * workflow instance before treating the order attempt as finished.
 */
export class WorkflowAbandonError extends OrderDomainError {
  readonly code = "WORKFLOW_FAILURE" as const;
  readonly orderId: string;
  readonly workflowInstanceId: string;
  readonly phase = "abandon" as const;
  readonly recoveryRequired = true as const;
  readonly recoveryAction = "abandon" as const;
  readonly committed = false as const;

  constructor(orderId: string, workflowInstanceId: string, cause?: unknown) {
    super("The order workflow could not be reconciled", 503, {cause});
    this.orderId = orderId;
    this.workflowInstanceId = workflowInstanceId;
  }
}

export class WorkflowAllocationError extends OrderDomainError {
  readonly code = "WORKFLOW_FAILURE" as const;
  readonly orderId: string;
  readonly workflowInstanceId: string;
  readonly phase = "finalize" as const;
  /** The order is already committed and needs the protected allocate action. */
  readonly recoveryRequired = true as const;
  readonly recoveryAction = "allocate" as const;
  readonly committed = true as const;

  constructor(orderId: string, workflowInstanceId: string, cause?: unknown) {
    super("The order was saved but allocation workflow activation failed", 503, { cause });
    this.orderId = orderId;
    this.workflowInstanceId = workflowInstanceId;
  }
}

/** The persistence result could not be reconciled to a committed order. */
export class WorkflowCommitReconciliationError extends OrderDomainError {
  readonly code = "WORKFLOW_FAILURE" as const;
  readonly orderId: string;
  readonly workflowInstanceId: string;
  readonly phase = "reconcile" as const;
  readonly recoveryRequired = true as const;
  readonly recoveryAction = "reconcile" as const;
  readonly committed = false as const;

  constructor(orderId: string, workflowInstanceId: string, cause?: unknown) {
    super("The order commit could not be reconciled", 503, {cause});
    this.orderId = orderId;
    this.workflowInstanceId = workflowInstanceId;
  }
}

/** The order was confirmed absent after an ambiguous persistence outcome. */
export class WorkflowCommitUnconfirmedError extends OrderDomainError {
  readonly code = "WORKFLOW_FAILURE" as const;
  readonly orderId: string;
  readonly workflowInstanceId: string;
  readonly phase = "commit" as const;
  readonly committed = false as const;
  readonly retryable = true as const;

  constructor(orderId: string, workflowInstanceId: string, cause?: unknown) {
    super("The order commit could not be confirmed", 503, {cause});
    this.orderId = orderId;
    this.workflowInstanceId = workflowInstanceId;
  }
}

export interface OrderResult {
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

/**
 * Parse an untrusted route body and map Zod's details to the order domain.
 */
export function parseOrderRequest(input: unknown): OrderRequest {
  const parsed = orderRequestSchema.safeParse(input);
  if (!parsed.success) throw new BadOrderRequestError(parsed.error.issues);
  return parsed.data;
}

function canonicalOffer(offer: Offer): string {
  return JSON.stringify({
    templateId: offer.templateId,
    placement: offer.placement,
    usedArea: offer.usedArea,
    price: offer.price,
    ownerShare: offer.ownerShare,
  });
}

/**
 * A stable, non-secret fingerprint for detecting a stale displayed offer.
 * Authorization still comes from recomputation and optimistic persistence.
 */
export function fingerprintOffer(offer: Offer): string {
  return `offer-v1-${hashString(canonicalOffer(offer))}`;
}

export const offerFingerprint = fingerprintOffer;

function hashString(value: string): string {
  // Two independent 32-bit FNV-style lanes avoid a runtime crypto dependency
  // while producing a compact stable identifier for persistence and tests.
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x01000193) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function secureUuid(): string {
  const runtimeCrypto = globalThis.crypto as Crypto & {
    randomUUID?: () => string;
  };
  if (typeof runtimeCrypto?.randomUUID === "function") return runtimeCrypto.randomUUID();

  if (typeof runtimeCrypto?.getRandomValues !== "function") {
    throw new Error("A cryptographically secure random source is required for order IDs");
  }
  const bytes = runtimeCrypto.getRandomValues(new Uint8Array(16));
  // RFC 4122 version 4 and variant bits keep the generated ID conventional.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function defaultOrderId(request: OrderRequest): string {
  if (request.idempotencyKey !== undefined) {
    return `orders.${hashString(`order-key-v1\u0000${request.remnantId}\u0000${request.idempotencyKey}`)}`;
  }
  return `orders.${secureUuid()}`;
}

function asCreatedAt(value: Date | string | undefined): string {
  if (value === undefined) return new Date().toISOString();
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error("Order clock returned an invalid date");
    return date.toISOString();
  }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Order clock returned an invalid date");
  }
  return value.toISOString();
}

function isConflictResult(result: CommitOrderResult): boolean {
  return (
    result === false ||
    (typeof result === "object" &&
      result !== null &&
      (result.conflict === true || result.committed === false))
  );
}

function isConflictError(error: unknown): boolean {
  if (error instanceof OrderConflictError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown; statusCode?: unknown };
  return (
    candidate.code === "CONFLICT" ||
    candidate.code === "conflict" ||
    candidate.status === 409 ||
    candidate.statusCode === 409
  );
}

function requireDependency<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`Order service dependency is missing: ${name}`);
  return value;
}

async function resolveRates(
  rates: OfferRates | (() => OfferRates | Promise<OfferRates>) | undefined,
): Promise<OfferRates> {
  if (typeof rates === "function") return await rates();
  return rates ?? {};
}

/**
 * Creates the framework-free order command used by the API route.
 *
 * Persistence and workflow are deliberately separate. If workflow activation
 * fails after the commit, the returned domain error carries the committed
 * order and workflow IDs so the protected recovery route can call the
 * idempotent allocation action again.
 */
export async function createOrder(
  input: unknown,
  dependencies: OrderServiceDependencies,
): Promise<OrderResult> {
  const request = parseOrderRequest(input);
  const load = dependencies.loadOrderContext ?? dependencies.loadContext;
  const commit = dependencies.commitOrder ?? dependencies.persistOrder;
  const allocate = dependencies.allocate ?? dependencies.workflow?.allocate;
  const prepare = dependencies.prepareWorkflow ?? dependencies.workflow?.prepare;

  const keyedOrderId = request.idempotencyKey === undefined ? undefined : defaultOrderId(request);
  const loadOrderReplay = dependencies.loadOrderReplay ?? dependencies.loadReplay;
  const recoverOrderReplay = dependencies.recoverReplay ?? dependencies.recoverOrderReplay;
  if (keyedOrderId !== undefined && loadOrderReplay) {
    const replay = await loadOrderReplay({
      orderId: keyedOrderId,
      remnantId: request.remnantId,
      templateId: request.templateId,
      buyerName: request.buyerName,
      buyerEmail: request.buyerEmail,
      idempotencyKey: request.idempotencyKey as string,
    });
    if (replay?.status === "mismatch") {
      throw new OrderConflictError("That idempotency key was already used for a different order", keyedOrderId);
    }
    if (replay?.status === "matched") {
      if (recoverOrderReplay) {
        try {
          await recoverOrderReplay({
            orderId: replay.orderId,
            workflowInstanceId: replay.workflowInstanceId,
          });
        } catch (error) {
          if (error instanceof WorkflowAllocationError) throw error;
          throw new WorkflowAllocationError(replay.orderId, replay.workflowInstanceId, error);
        }
      }
      return {
        orderId: replay.orderId,
        workflowInstanceId: replay.workflowInstanceId,
        remnantId: replay.remnantId,
        templateId: replay.templateId,
        placement: replay.placement.map((piece) => ({...piece})),
        usedArea: replay.usedArea,
        price: replay.price,
        ownerShare: replay.ownerShare,
        createdAt: replay.createdAt,
      };
    }
  }

  const loadOrderContext = requireDependency(load, "loadOrderContext");
  const commitOrder = requireDependency(commit, "commitOrder");
  const allocateOrder = requireDependency(allocate, "allocate");
  const prepareWorkflow = requireDependency(prepare, "prepareWorkflow");

  const context = await loadOrderContext(request.remnantId);
  if (!context) {
    throw new UnavailableOfferError("REMNANT_NOT_FOUND", request);
  }

  const status = context.remnant.status;
  if (status !== "listed" && status !== "allocated") {
    throw new UnavailableOfferError("REMNANT_NOT_LISTED", request);
  }
  if (!context.remnant._rev) {
    // A snapshot without a revision cannot be safely committed.
    throw new OrderConflictError("The remnant snapshot has no optimistic revision");
  }

  const rates = await resolveRates(dependencies.rates);
  const offers = computeOffers(context.remnant, context.templates, rates);
  const offer = offers.find((candidate) => candidate.templateId === request.templateId);
  if (!offer) {
    throw new UnavailableOfferError("TEMPLATE_UNAVAILABLE", request);
  }
  if (request.offerFingerprint !== undefined && request.offerFingerprint !== fingerprintOffer(offer)) {
    throw new UnavailableOfferError("STALE_OFFER", request);
  }

  const orderId =
    keyedOrderId ??
    dependencies.createOrderId?.({request, context, offer}) ??
    dependencies.generateOrderId?.({request, context, offer}) ??
    defaultOrderId(request);
  if (!orderId || !orderId.trim()) throw new Error("Order ID generator returned an empty ID");

  const placement = offer.placement.map((piece) => ({...piece}));
  let preparedWorkflow: PrepareWorkflowResult;
  try {
    preparedWorkflow = await prepareWorkflow({
      orderId,
      remnantId: request.remnantId,
      templateId: request.templateId,
      workflowInstanceId: `tessom-order-attempt-${secureUuid()}`,
      placement: placement.map((piece) => ({...piece})),
      usedArea: offer.usedArea,
      price: offer.price,
      ownerShare: offer.ownerShare,
    });
  } catch (error) {
    if (error instanceof WorkflowAbandonError) throw error;
    throw new WorkflowPreparationError(error);
  }
  if (
    !preparedWorkflow ||
    typeof preparedWorkflow.workflowInstanceId !== "string" ||
    !preparedWorkflow.workflowInstanceId.trim()
  ) {
    throw new WorkflowPreparationError(new Error("Workflow preparation returned no instance ID"));
  }

  const workflowInstanceId = preparedWorkflow.workflowInstanceId;
  const createdAt = asCreatedAt(dependencies.now?.());
  const allocations: AllocationInput[] = placement.map((piece) => ({
    ...piece,
    order: {_type: "reference", _ref: orderId},
  }));
  const order: OrderDocumentInput = {
    _id: orderId,
    _type: "order",
    remnant: {_type: "reference", _ref: request.remnantId},
    template: {_type: "reference", _ref: request.templateId},
    placement,
    price: offer.price,
    ownerShare: offer.ownerShare,
    buyerName: request.buyerName,
    buyerEmail: request.buyerEmail,
    workflowInstanceId,
    createdAt,
  };
  const commitInput: OrderCommitInput = {
    orderId,
    remnantId: request.remnantId,
    templateId: request.templateId,
    idempotencyKey: request.idempotencyKey,
    expectedRevision: context.remnant._rev,
    ifRevisionId: context.remnant._rev,
    nextRemnantStatus: "allocated",
    placement,
    usedArea: offer.usedArea,
    price: offer.price,
    ownerShare: offer.ownerShare,
    allocations,
    order,
  };

  let commitResult: CommitOrderResult;
  try {
    commitResult = await commitOrder(commitInput);
  } catch (error) {
    if (isConflictError(error)) throw new OrderConflictError(undefined, orderId, workflowInstanceId);
    throw error;
  }
  if (isConflictResult(commitResult)) {
    throw new OrderConflictError(undefined, orderId, workflowInstanceId);
  }
  if (
    commitResult &&
    typeof commitResult === "object" &&
    commitResult.existing === true &&
    commitResult.replay
  ) {
    return {
      ...commitResult.replay,
      placement: commitResult.replay.placement.map((piece) => ({...piece})),
    };
  }

  try {
    await allocateOrder({
      orderId,
      workflowInstanceId,
      remnantId: request.remnantId,
      templateId: request.templateId,
      placement: placement.map((piece) => ({...piece})),
      usedArea: offer.usedArea,
    });
  } catch (error) {
    throw new WorkflowAllocationError(orderId, workflowInstanceId, error);
  }

  return {
    orderId,
    workflowInstanceId,
    remnantId: request.remnantId,
    templateId: request.templateId,
    placement,
    usedArea: offer.usedArea,
    price: offer.price,
    ownerShare: offer.ownerShare,
    createdAt,
  };
}

export const createOrderCommand = createOrder;
