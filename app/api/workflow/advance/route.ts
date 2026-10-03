import {NextResponse} from "next/server";
import {z} from "zod";

import {MAX_JSON_BODY_BYTES, readJsonBody} from "../../../../lib/http/json-body";
import {SANITY_DOCUMENT_ID_PATTERN} from "../../../../lib/http/sanity-id";
import {tooManyRequests} from "../../../../lib/http/rate-limit";
import {checkWorkshopPin} from "../../../../lib/workshop/auth";
import {pinAttemptsBlocked, recordPinFailure} from "../../../../lib/workshop/pin-guard";
import {computeOffers} from "../../../../lib/offers";
import {DEFAULT_OFFER_RATES} from "../../../../lib/offers/rates";
import {
  fetchConsentWorkflowState,
  fetchLifecycleWorkflowState,
  fetchOrderWorkflowBinding,
  fetchOrderWorkflowState,
  patchRemnantStatus,
  type ConsentWorkflowState,
  type ProductionWorkflowState,
  type WorkflowRemnantStatus,
} from "../../../../lib/sanity/workflow-state";
import {
  SanityDataValidationError,
  SanityRevisionConflictError,
  isSanityRevisionConflict,
} from "../../../../lib/sanity/orders";
import {
  closeShippedAsSoldOut,
  allocateRemnant,
  abandonLifecycleAllocation,
  consentInstanceId,
  declineConsent,
  grantConsent,
  markCut,
  markSewn,
  markShipped,
  returnShippedToListed,
  tickWorkflowInstance,
  WORKFLOW_DEFINITION_NAME,
  workflowTagFromEnvironment,
} from "../../../../lib/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const NO_STORE_HEADERS = {"Cache-Control": "no-store"};

const documentId = () => z.string().trim().regex(SANITY_DOCUMENT_ID_PATTERN);

const consentRequest = z
  .object({
    action: z.literal("grant"),
    remnantId: documentId(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
const declineRequest = z
  .object({
    action: z.literal("decline"),
    remnantId: documentId(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
const cutRequest = z
  .object({
    action: z.literal("mark-cut"),
    workflowInstanceId: documentId(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
const sewnRequest = z
  .object({
    action: z.literal("mark-sewn"),
    workflowInstanceId: documentId(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
const shippedRequest = z
  .object({
    action: z.literal("mark-shipped"),
    workflowInstanceId: documentId(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
const allocateRequest = z
  .object({
    action: z.literal("allocate"),
    workflowInstanceId: documentId(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
const abandonRequest = z
  .object({
    action: z.literal("abandon"),
    workflowInstanceId: documentId(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
const reconcileRequest = z
  .object({
    action: z.literal("reconcile"),
    orderId: documentId(),
    workflowInstanceId: documentId(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const workflowAdvanceRequestSchema = z.discriminatedUnion("action", [
  consentRequest,
  declineRequest,
  cutRequest,
  sewnRequest,
  shippedRequest,
  allocateRequest,
  abandonRequest,
  reconcileRequest,
]);
export const workflowAdvanceSchema = workflowAdvanceRequestSchema;

export type WorkflowAdvanceRequest = z.infer<typeof workflowAdvanceRequestSchema>;

class InvalidWorkflowAdvanceRequestError extends Error {
  constructor() {
    super("Invalid workflow request");
    this.name = "InvalidWorkflowAdvanceRequestError";
  }
}

class UnauthorizedWorkflowError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedWorkflowError";
  }
}

class MissingWorkflowConfigurationError extends Error {
  constructor() {
    super("Workflow service configuration is unavailable");
    this.name = "MissingWorkflowConfigurationError";
  }
}

class MissingWorkflowRecordError extends Error {
  constructor() {
    super("Not found");
    this.name = "MissingWorkflowRecordError";
  }
}

class WorkflowAdvanceConflictError extends Error {
  constructor() {
    super("This changed while you were working. Try again.");
    this.name = "WorkflowAdvanceConflictError";
  }
}

type Operation = unknown;

export interface WorkflowAdvanceDependencies {
  fetchConsentWorkflowState: typeof fetchConsentWorkflowState;
  fetchLifecycleWorkflowState: typeof fetchLifecycleWorkflowState;
  fetchOrderWorkflowBinding: typeof fetchOrderWorkflowBinding;
  fetchOrderWorkflowState: typeof fetchOrderWorkflowState;
  patchRemnantStatus: typeof patchRemnantStatus;
  grantConsent: typeof grantConsent;
  declineConsent: typeof declineConsent;
  markCut: typeof markCut;
  markSewn: typeof markSewn;
  markShipped: typeof markShipped;
  returnShippedToListed: typeof returnShippedToListed;
  closeShippedAsSoldOut: typeof closeShippedAsSoldOut;
  allocateRemnant: typeof allocateRemnant;
  abandonLifecycleAllocation: typeof abandonLifecycleAllocation;
  tickWorkflowInstance: typeof tickWorkflowInstance;
  workflowTagFromEnvironment: typeof workflowTagFromEnvironment;
}

const defaultDependencies: WorkflowAdvanceDependencies = {
  fetchConsentWorkflowState,
  fetchLifecycleWorkflowState,
  fetchOrderWorkflowBinding,
  fetchOrderWorkflowState,
  patchRemnantStatus,
  grantConsent,
  declineConsent,
  markCut,
  markSewn,
  markShipped,
  returnShippedToListed,
  closeShippedAsSoldOut,
  allocateRemnant,
  abandonLifecycleAllocation,
  tickWorkflowInstance,
  workflowTagFromEnvironment,
};

function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {status, headers: NO_STORE_HEADERS});
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await readJsonBody(request, MAX_JSON_BODY_BYTES);
  } catch {
    throw new InvalidWorkflowAdvanceRequestError();
  }
}

function requireWorkshopPin(request: Request): void {
  const check = checkWorkshopPin(request.headers);
  if (check === "unconfigured") throw new MissingWorkflowConfigurationError();
  if (check === "unauthorized") throw new UnauthorizedWorkflowError();
}

function parseRequest(input: unknown): WorkflowAdvanceRequest {
  const parsed = workflowAdvanceRequestSchema.safeParse(input);
  if (!parsed.success) throw new InvalidWorkflowAdvanceRequestError();
  return parsed.data;
}

function operationStage(operation: Operation): string | undefined {
  if (!operation || typeof operation !== "object") return undefined;
  const instance = (operation as {instance?: unknown}).instance;
  if (!instance || typeof instance !== "object") return undefined;
  const stage = (instance as {currentStage?: unknown}).currentStage;
  return typeof stage === "string" && stage.length <= 80 ? stage : undefined;
}

function operationAllocationUsed(operation: Operation): boolean | undefined {
  if (!operation || typeof operation !== "object") return undefined;
  const instance = (operation as {instance?: unknown}).instance;
  if (!instance || typeof instance !== "object") return undefined;
  const fields = (instance as {fields?: unknown}).fields;
  if (!Array.isArray(fields)) return undefined;
  const allocationUsed = fields.find((field) => {
    if (!field || typeof field !== "object") return false;
    return (field as {name?: unknown}).name === "allocationUsed";
  });
  if (!allocationUsed || typeof allocationUsed !== "object") return undefined;
  const value = (allocationUsed as {value?: unknown}).value;
  return typeof value === "boolean" ? value : undefined;
}

function actionIdempotencyKey(input: WorkflowAdvanceRequest, instanceId: string, suffix: string = input.action): string {
  // Keep caller keys stable across retries while namespacing them to the
  // instance and typed action. A key reused for another action cannot
  // accidentally suppress that action in the workflow ledger.
  return `${instanceId}:${suffix}:${input.idempotencyKey ?? "default"}`;
}

function workflowStage(state: ConsentWorkflowState | ProductionWorkflowState): string {
  if (!state.workflow) throw new MissingWorkflowConfigurationError();
  return state.workflow.currentStage;
}

function assertReachedStage(operation: Operation, tick: Operation, expected: string): string {
  const actionStage = operationStage(operation);
  const tickStage = operationStage(tick);
  if (actionStage !== expected && tickStage !== expected) {
    throw new WorkflowAdvanceConflictError();
  }
  return expected;
}

function hasStatus(value: string, ...statuses: string[]): boolean {
  return statuses.includes(value);
}

type SettlementStatus = "listed" | "sold-out";

function settledStatus(state: ProductionWorkflowState): SettlementStatus | undefined {
  const workflow = state.workflow;
  if (!workflow) return undefined;
  if (workflow.settlement === "listed" || workflow.settlement === "sold-out") {
    return workflow.settlement;
  }
  return undefined;
}

function persistedAllocationOrderIds(state: ProductionWorkflowState): string[] {
  if (!state.remnant) return [];
  const projected = state.remnant.allocationOrderIds ?? [];
  const inline = (state.remnant.allocations ?? []).flatMap((allocation) => {
    if (!allocation || typeof allocation !== "object") return [];
    const orderId = (allocation as {orderId?: unknown}).orderId;
    const reference =
      orderId ??
      ((allocation as {order?: { _ref?: unknown }}).order?._ref);
    return typeof reference === "string" && reference.length > 0 ? [reference] : [];
  });
  return [...projected, ...inline];
}

function requireOperation(operation: Operation): Operation {
  if (operation === undefined) throw new MissingWorkflowConfigurationError();
  return operation;
}

function requireStateWorkflow(state: ConsentWorkflowState | ProductionWorkflowState): void {
  if (!state.workflow) throw new MissingWorkflowConfigurationError();
}

function requireLifecycleWorkflow(
  state: ProductionWorkflowState,
  expectedTag?: string,
): NonNullable<ProductionWorkflowState["workflow"]> {
  requireStateWorkflow(state);
  const workflow = state.workflow!;
  if (
    workflow.definition !== WORKFLOW_DEFINITION_NAME ||
    (expectedTag !== undefined && workflow.tag !== expectedTag) ||
    (workflow.mode !== undefined && workflow.mode !== "lifecycle")
  ) {
    throw new WorkflowAdvanceConflictError();
  }
  return workflow;
}

function requirePreparedLifecycleWorkflow(
  workflow: NonNullable<ProductionWorkflowState["workflow"]> | null,
  allowUsed = false,
  expectedTag?: string,
  expectedInstanceId?: string,
): NonNullable<ProductionWorkflowState["workflow"]> {
  if (
    !workflow ||
    workflow.definition !== WORKFLOW_DEFINITION_NAME ||
    (expectedTag !== undefined && workflow.tag !== expectedTag) ||
    (expectedInstanceId !== undefined && workflow._id !== expectedInstanceId) ||
    workflow.mode !== "lifecycle" ||
    workflow.currentStage !== "listed" ||
    (workflow.allocationUsed !== false && !(allowUsed && workflow.allocationUsed === true))
  ) {
    throw new WorkflowAdvanceConflictError();
  }
  return workflow;
}

type AllocationRecoveryRequest = Extract<WorkflowAdvanceRequest, {action: "allocate" | "reconcile"}>;

async function recoverPersistedAllocation(
  input: AllocationRecoveryRequest,
  state: ProductionWorkflowState,
  tag: string,
  deps: WorkflowAdvanceDependencies,
): Promise<Record<string, unknown>> {
  if (!state.remnant) throw new MissingWorkflowRecordError();
  const workflow = requireLifecycleWorkflow(state, tag);
  const allocationOrderIds = persistedAllocationOrderIds(state);
  if (!allocationOrderIds.includes(state.orderId)) throw new WorkflowAdvanceConflictError();
  if (!hasStatus(state.remnant.status, "allocated", "sold-out")) throw new WorkflowAdvanceConflictError();
  if (["allocated", "cut", "sewn", "shipped", "sold-out"].includes(workflow.currentStage)) {
    return {
      action: input.action,
      ...(input.action === "reconcile" ? {orderId: input.orderId} : {}),
      workflowInstanceId: state.workflowInstanceId,
      remnantId: state.remnant._id,
      status: state.remnant.status,
      stage: workflow.currentStage,
    };
  }
  if (workflow.currentStage !== "listed" || state.remnant.status !== "allocated") {
    throw new WorkflowAdvanceConflictError();
  }

  const idempotencyKey = actionIdempotencyKey(input, state.workflowInstanceId, "allocate");
  const operation = requireOperation(
    await deps.allocateRemnant(state.workflowInstanceId, {idempotencyKey, idempotent: true}),
  );
  const tick = requireOperation(
    await deps.tickWorkflowInstance(state.workflowInstanceId, {idempotencyKey, idempotent: true}),
  );
  const stage = assertReachedStage(operation, tick, "allocated");
  return {
    action: input.action,
    ...(input.action === "reconcile" ? {orderId: input.orderId} : {}),
    workflowInstanceId: state.workflowInstanceId,
    remnantId: state.remnant._id,
    status: state.remnant.status,
    stage,
  };
}

async function advanceConsent(
  input: Extract<WorkflowAdvanceRequest, {action: "grant" | "decline"}>,
  tag: string,
  deps: WorkflowAdvanceDependencies,
): Promise<Record<string, unknown>> {
  const instanceId = consentInstanceId(input.remnantId, tag as Parameters<typeof consentInstanceId>[1]);
  const state = await deps.fetchConsentWorkflowState(input.remnantId, instanceId, tag);
  if (!state) throw new MissingWorkflowRecordError();
  requireStateWorkflow(state);

  const currentStage = workflowStage(state);
  const targetStage = input.action === "grant" ? "listed" : "returned";
  const allowedStatuses = input.action === "grant" ? ["intake", "consented", "listed"] : ["intake", "consented", "returned"];

  // A consent instance is deterministic and only has one action that can
  // reach each terminal stage. A terminal workflow stage with the matching
  // remnant status is already complete, while the same stage with an
  // awaiting status is a safe status-patch retry.
  if (currentStage === targetStage) {
    if (!hasStatus(state.remnant.status, ...allowedStatuses)) throw new WorkflowAdvanceConflictError();
    if (state.remnant.status === targetStage) {
      return {
        action: input.action,
        workflowInstanceId: instanceId,
        remnantId: state.remnant._id,
        status: targetStage,
        stage: currentStage,
      };
    }
    await deps.patchRemnantStatus(input.remnantId, targetStage, state.remnant._rev);
    return {
      action: input.action,
      workflowInstanceId: instanceId,
      remnantId: state.remnant._id,
      status: targetStage,
      stage: currentStage,
    };
  }

  if (currentStage !== "awaiting-consent" || !hasStatus(state.remnant.status, "intake", "consented")) {
    throw new WorkflowAdvanceConflictError();
  }

  const idempotencyKey = actionIdempotencyKey(input, instanceId);
  const operation = requireOperation(
    input.action === "grant"
      ? await deps.grantConsent(instanceId, {idempotencyKey, idempotent: true})
      : await deps.declineConsent(instanceId, {idempotencyKey, idempotent: true}),
  );
  const tick = requireOperation(await deps.tickWorkflowInstance(instanceId, {idempotencyKey, idempotent: true}));
  const stage = assertReachedStage(operation, tick, targetStage);
  const status = targetStage;
  await deps.patchRemnantStatus(input.remnantId, status, state.remnant._rev);
  return {
    action: input.action,
    workflowInstanceId: instanceId,
    remnantId: state.remnant._id,
    status,
    stage,
  };
}

async function advanceProduction(
  input: Extract<WorkflowAdvanceRequest, {action: "mark-cut" | "mark-sewn" | "mark-shipped" | "allocate"}>,
  tag: string,
  deps: WorkflowAdvanceDependencies,
): Promise<Record<string, unknown>> {
  const state = await deps.fetchOrderWorkflowState(input.workflowInstanceId, tag);
  if (!state) throw new MissingWorkflowRecordError();
  requireLifecycleWorkflow(state, tag);
  if (!state.remnant) throw new MissingWorkflowRecordError();

  const instanceId = state.workflowInstanceId;

  if (input.action === "allocate") {
    return recoverPersistedAllocation(input, state, tag, deps);
  }

  const currentStage = workflowStage(state);
  const expectedStage = input.action === "mark-cut" ? "cut" : input.action === "mark-sewn" ? "sewn" : "shipped";

  if (input.action === "mark-cut" && currentStage === "cut") {
    return {action: input.action, workflowInstanceId: instanceId, remnantId: state.remnant._id, status: state.remnant.status, stage: currentStage};
  }
  if (input.action === "mark-sewn" && currentStage === "sewn") {
    return {action: input.action, workflowInstanceId: instanceId, remnantId: state.remnant._id, status: state.remnant.status, stage: currentStage};
  }

  if (
    (input.action === "mark-cut" && currentStage !== "allocated") ||
    (input.action === "mark-sewn" && currentStage !== "cut") ||
    (input.action === "mark-shipped" && !["sewn", "shipped", "listed", "sold-out"].includes(currentStage))
  ) {
    throw new WorkflowAdvanceConflictError();
  }

  const requiresAllocatedRemnant =
    (input.action === "mark-cut" && currentStage === "allocated") ||
    (input.action === "mark-sewn" && currentStage === "cut") ||
    (input.action === "mark-shipped" && currentStage === "sewn");
  if (requiresAllocatedRemnant && state.remnant.status !== "allocated") {
    throw new WorkflowAdvanceConflictError();
  }

  if (input.action === "mark-shipped" && ["listed", "sold-out"].includes(currentStage)) {
    if (state.workflow?.settlement !== currentStage) throw new WorkflowAdvanceConflictError();
    return settleShipped(state, input, tag, deps, instanceId, true);
  }

  if (input.action === "mark-shipped" && currentStage === "shipped") {
    return settleShipped(state, input, tag, deps, instanceId, false, "shipped");
  }

  const idempotencyKey = actionIdempotencyKey(input, instanceId);
  const operation = requireOperation(
    input.action === "mark-cut"
      ? await deps.markCut(instanceId, {idempotencyKey, idempotent: true})
      : input.action === "mark-sewn"
        ? await deps.markSewn(instanceId, {idempotencyKey, idempotent: true})
        : await deps.markShipped(instanceId, {idempotencyKey, idempotent: true}),
  );
  const tick = requireOperation(await deps.tickWorkflowInstance(instanceId, {idempotencyKey, idempotent: true}));
  const stage = assertReachedStage(operation, tick, expectedStage);

  if (input.action !== "mark-shipped") {
    return {
      action: input.action,
      workflowInstanceId: instanceId,
      remnantId: state.remnant._id,
      status: state.remnant.status,
      stage,
    };
  }

  return settleShipped(state, input, tag, deps, instanceId, false, stage);
}

async function settleShipped(
  state: ProductionWorkflowState,
  input: Extract<WorkflowAdvanceRequest, {action: "mark-shipped"}>,
  tag: string,
  deps: WorkflowAdvanceDependencies,
  instanceId: string,
  alreadySettled: boolean,
  shippedStage = "shipped",
): Promise<Record<string, unknown>> {
  // Always re-read the order and remnant after shipping. Another committed
  // order may have consumed the last offer since the first request snapshot.
  const current = await deps.fetchOrderWorkflowState(instanceId, tag);
  if (!current) throw new MissingWorkflowRecordError();
  requireLifecycleWorkflow(current, tag);
  if (!current.remnant) throw new MissingWorkflowRecordError();
  if (current.orderId !== state.orderId || current.remnantId !== state.remnantId) {
    throw new WorkflowAdvanceConflictError();
  }

  let stage = shippedStage;
  const completedSettlement = settledStatus(state) ?? settledStatus(current);
  if (alreadySettled || completedSettlement) {
    const status = completedSettlement;
    if (!status) throw new WorkflowAdvanceConflictError();
    if (
      (current.workflow?.currentStage === "listed" || current.workflow?.currentStage === "sold-out") &&
      current.workflow.settlement !== current.workflow.currentStage
    ) {
      throw new WorkflowAdvanceConflictError();
    }
    const reconciledStatus = await reconcileShippedSettlement(current, deps, status);
    const completedStage =
      current.workflow?.currentStage === "listed" || current.workflow?.currentStage === "sold-out"
        ? current.workflow.currentStage
        : state.workflow?.currentStage === "listed" || state.workflow?.currentStage === "sold-out"
          ? state.workflow.currentStage
          : stage;
    return {
      action: input.action,
      workflowInstanceId: instanceId,
      remnantId: current.remnant._id,
      status: reconciledStatus,
      stage: completedStage,
    };
  }

  const offers = computeOffers(current.remnant, current.templates, DEFAULT_OFFER_RATES);
  const status: SettlementStatus = offers.length > 0 ? "listed" : "sold-out";
  const settlementAction = offers.length > 0 ? "return-to-listed" : "close-sold-out";
  const settlementKey = actionIdempotencyKey(input, instanceId, settlementAction);
  if (!alreadySettled) {
    const settlement = requireOperation(
      offers.length > 0
        ? await deps.returnShippedToListed(instanceId, {idempotencyKey: settlementKey, idempotent: true})
        : await deps.closeShippedAsSoldOut(instanceId, {idempotencyKey: settlementKey, idempotent: true}),
    );
    const settlementTick = requireOperation(
      await deps.tickWorkflowInstance(instanceId, {idempotencyKey: settlementKey, idempotent: true}),
    );
    stage = assertReachedStage(settlement, settlementTick, status);
  }

  const reconciledStatus = await reconcileShippedSettlement(current, deps, status);

  return {
    action: input.action,
    workflowInstanceId: instanceId,
    remnantId: current.remnant._id,
    status: reconciledStatus,
    stage,
  };
}

async function reconcileShippedSettlement(
  current: ProductionWorkflowState,
  deps: WorkflowAdvanceDependencies,
  settlement: SettlementStatus,
): Promise<WorkflowRemnantStatus> {
  const offers = computeOffers(current.remnant!, current.templates, DEFAULT_OFFER_RATES);
  const availability: SettlementStatus = offers.length > 0 ? "listed" : "sold-out";

  // A later allocation can consume the last offer after a workflow has
  // settled as listed. Preserve that allocation and report the current
  // remnant status instead of reverting it to listed.
  const canReconcile = availability === settlement;
  let status = current.remnant!.status;
  if (canReconcile && status !== settlement) {
    await deps.patchRemnantStatus(current.remnant!._id, settlement, current.remnant!._rev);
    status = settlement;
  }

  return status;
}

type LifecycleState = Awaited<ReturnType<typeof fetchLifecycleWorkflowState>>;

async function abandonPreparedWorkflow(
  input: Extract<WorkflowAdvanceRequest, {action: "abandon" | "reconcile"}>,
  prepared: NonNullable<LifecycleState>,
  tag: string,
  deps: WorkflowAdvanceDependencies,
): Promise<Record<string, unknown>> {
  const workflow = requirePreparedLifecycleWorkflow(prepared, true, tag, input.workflowInstanceId);
  if (workflow.allocationUsed === true) {
    return {
      action: input.action,
      ...(input.action === "reconcile" ? {orderId: input.orderId} : {}),
      workflowInstanceId: workflow._id,
      stage: workflow.currentStage,
      allocationUsed: true,
    };
  }

  const idempotencyKey = actionIdempotencyKey(input, workflow._id, "abandon");
  const operation = requireOperation(
    await deps.abandonLifecycleAllocation(workflow._id, {idempotencyKey, idempotent: true}),
  );
  if (operationStage(operation) !== "listed" || operationAllocationUsed(operation) !== true) {
    throw new WorkflowAdvanceConflictError();
  }

  const verified = await deps.fetchLifecycleWorkflowState(workflow._id, tag);
  if (!verified) throw new MissingWorkflowRecordError();
  const verifiedWorkflow = requirePreparedLifecycleWorkflow(verified, true, tag, input.workflowInstanceId);
  if (verifiedWorkflow.allocationUsed !== true) throw new WorkflowAdvanceConflictError();
  return {
    action: input.action,
    ...(input.action === "reconcile" ? {orderId: input.orderId} : {}),
    workflowInstanceId: verifiedWorkflow._id,
    stage: verifiedWorkflow.currentStage,
    allocationUsed: true,
  };
}

async function abandonWorkflow(
  input: Extract<WorkflowAdvanceRequest, {action: "abandon"}>,
  tag: string,
  deps: WorkflowAdvanceDependencies,
): Promise<Record<string, unknown>> {
  const prepared = await deps.fetchLifecycleWorkflowState(input.workflowInstanceId, tag);
  if (!prepared) throw new MissingWorkflowRecordError();
  return abandonPreparedWorkflow(input, prepared, tag, deps);
}

async function reconcileWorkflow(
  input: Extract<WorkflowAdvanceRequest, {action: "reconcile"}>,
  tag: string,
  deps: WorkflowAdvanceDependencies,
): Promise<Record<string, unknown>> {
  const binding = await deps.fetchOrderWorkflowBinding(input.orderId);
  if (binding) {
    if (binding.workflowInstanceId !== input.workflowInstanceId) throw new WorkflowAdvanceConflictError();
    const state = await deps.fetchOrderWorkflowState(input.workflowInstanceId, tag);
    if (!state) throw new MissingWorkflowRecordError();
    if (state.orderId !== input.orderId || (binding.remnantId !== undefined && state.remnantId !== binding.remnantId)) {
      throw new WorkflowAdvanceConflictError();
    }
    return recoverPersistedAllocation(input, state, tag, deps);
  }

  const prepared = await deps.fetchLifecycleWorkflowState(input.workflowInstanceId, tag);
  if (!prepared) throw new MissingWorkflowRecordError();
  if (prepared.orderId !== undefined && prepared.orderId !== input.orderId) {
    throw new WorkflowAdvanceConflictError();
  }
  return abandonPreparedWorkflow(input, prepared, tag, deps);
}

export async function advanceWorkflow(
  input: WorkflowAdvanceRequest,
  deps: WorkflowAdvanceDependencies = defaultDependencies,
): Promise<Record<string, unknown>> {
  const tag = deps.workflowTagFromEnvironment();
  if (!tag) throw new MissingWorkflowConfigurationError();
  if (input.action === "grant" || input.action === "decline") {
    return advanceConsent(input, tag, deps);
  }
  if (input.action === "abandon") return abandonWorkflow(input, tag, deps);
  if (input.action === "reconcile") return reconcileWorkflow(input, tag, deps);
  return advanceProduction(input, tag, deps);
}

function isConflictLike(error: unknown, seen = new Set<unknown>()): boolean {
  if (error instanceof WorkflowAdvanceConflictError || isSanityRevisionConflict(error)) return true;
  if (!error || typeof error !== "object") return false;
  if (seen.has(error)) return false;
  seen.add(error);
  const value = error as {code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown};
  if (
    value.status === 409 ||
    value.status === "409" ||
    value.statusCode === 409 ||
    value.statusCode === "409" ||
    value.code === "CONFLICT"
  ) {
    return true;
  }
  if (typeof value.message === "string" && /revision|stage|transition|conflict|already.*(done|fired)|not available/i.test(value.message)) {
    return true;
  }
  return Object.values(value).some((nested) => isConflictLike(nested, seen));
}

function isMissingConfiguration(error: unknown): boolean {
  if (error instanceof MissingWorkflowConfigurationError) return true;
  if (!(error instanceof Error)) return false;
  return /missing required environment variable|configuration is unavailable|workflow service/i.test(error.message);
}

function responseForError(error: unknown): NextResponse {
  if (error instanceof InvalidWorkflowAdvanceRequestError) {
    return jsonResponse({error: "Invalid workflow request"}, 400);
  }
  if (error instanceof UnauthorizedWorkflowError) return jsonResponse({error: "Unauthorized"}, 401);
  if (error instanceof MissingWorkflowRecordError) {
    return jsonResponse({error: "Not found"}, 404);
  }
  if (isConflictLike(error) || error instanceof SanityRevisionConflictError) {
    return jsonResponse({error: "This changed while you were working. Try again."}, 409);
  }
  if (isMissingConfiguration(error)) {
    return jsonResponse({error: "Service unavailable"}, 503);
  }
  if (error instanceof SanityDataValidationError) {
    return jsonResponse({error: "Something went wrong. Try again."}, 500);
  }
  return jsonResponse({error: "Something went wrong. Try again."}, 500);
}

export async function POST(request: Request): Promise<NextResponse> {
  const waitSec = pinAttemptsBlocked(request);
  if (waitSec !== null) return tooManyRequests(waitSec);
  try {
    requireWorkshopPin(request);
    const input = parseRequest(await parseJsonBody(request));
    return jsonResponse(await advanceWorkflow(input));
  } catch (error) {
    if (error instanceof UnauthorizedWorkflowError) recordPinFailure(request);
    return responseForError(error);
  }
}
