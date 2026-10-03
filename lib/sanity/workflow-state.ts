import type {PatchOperations} from "@sanity/client";

import type {ProductTemplate, Rect, Remnant} from "../offers";
import {WORKFLOW_DEFINITION_NAME} from "../workflow";
import {
  createSanityServerClient,
  type SanityPersistenceClient,
  type SanityDocumentReadClient,
  type SanityReadClient,
} from "./client";
import {
  isSanityRevisionConflict,
  normalizeSanityRevisionConflict,
  SanityDataValidationError,
  SanityRevisionConflictError,
} from "./orders";

/**
 * The workflow route only needs this small, server-side remnant projection.
 * Buyer details and presentation fields deliberately stay out of the query.
 */
export interface WorkflowRemnantState extends Remnant {
  _id: string;
  _rev: string;
  status: WorkflowRemnantStatus;
  ownerShareBps?: number;
  /** Order IDs projected from persisted allocation references. */
  allocationOrderIds?: string[];
}

export type WorkflowRemnantStatus =
  | "intake"
  | "consented"
  | "listed"
  | "allocated"
  | "sold-out"
  | "returned";

export interface WorkflowInstanceState {
  _id: string;
  _rev?: string;
  tag: string;
  definition: string;
  currentStage: string;
  mode?: "consent" | "lifecycle";
  allocationUsed?: boolean;
  orderId?: string;
  remnantId?: string;
  settlement?: "listed" | "sold-out";
}

export interface WorkflowOrderBinding {
  orderId: string;
  workflowInstanceId: string;
  remnantId?: string;
}

export interface ConsentWorkflowState {
  remnant: ConsentRemnantRevision;
  workflow: WorkflowInstanceState | null;
}

export interface ConsentRemnantRevision {
  _id: string;
  _rev: string;
  status: WorkflowRemnantStatus;
}

export interface ProductionWorkflowState {
  orderId: string;
  workflowInstanceId: string;
  remnantId: string;
  remnant: WorkflowRemnantState | null;
  workflow: WorkflowInstanceState | null;
  templates: ProductTemplate[];
}

export type RemnantStatusPatch = "listed" | "returned" | "allocated" | "sold-out";

/** Parameterized GROQ for the consent remnant and its tag-scoped instance. */
export const CONSENT_WORKFLOW_STATE_QUERY = `{
  "remnant": *[_type == "remnant" && _id == $remnantId][0]{
    _id,
    _rev,
    status
  },
  "workflow": *[_type == "sanity.workflow.instance" && _id == $workflowInstanceId && tag == $workflowTag && definition == $workflowDefinition][0]{
    _id,
    _rev,
    tag,
    definition,
    currentStage,
    "mode": context[name == "mode"][0].value,
    "allocationUsed": fields[name == "allocationUsed"][0].value,
    fields[]{name, value}
  }
}`;

/**
 * Parameterized GROQ for the trusted order to workflow to remnant mapping.
 * The remnant reference is read from the order selected by workflowInstanceId.
 */
export const ORDER_WORKFLOW_REMNANT_QUERY = `{
  "order": *[_type == "order" && workflowInstanceId == $workflowInstanceId][0]{
    _id,
    workflowInstanceId,
    "remnantId": remnant._ref
  },
  "workflow": *[_type == "sanity.workflow.instance" && _id == $workflowInstanceId && tag == $workflowTag && definition == $workflowDefinition][0]{
    _id,
    _rev,
    tag,
    definition,
    currentStage,
    "mode": context[name == "mode"][0].value,
    "allocationUsed": fields[name == "allocationUsed"][0].value,
    fields[]{name, value}
  },
  "remnant": *[
    _type == "remnant" &&
    _id == (*[_type == "order" && workflowInstanceId == $workflowInstanceId][0].remnant._ref)
  ][0]{
    _id,
    _rev,
    status,
    widthCm,
    heightCm,
    fabric{name, maker, valuePerM},
    repeat{vCm, hCm},
    directional,
    defects[]{x, y, w, h},
    allocations[]{x, y, w, h, "orderId": order._ref},
    "ownerShareBps": owner->shareBps
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

// Descriptive aliases make the adapter easy to discover without exposing a
// second query implementation.
export const CONSENT_REMNANT_QUERY = CONSENT_WORKFLOW_STATE_QUERY;
export const ORDER_WORKFLOW_STATE_QUERY = ORDER_WORKFLOW_REMNANT_QUERY;

/**
 * Narrow, tag-scoped projection used by protected recovery actions. The
 * workflow engine stores the preparation mode in context and the allocation
 * guard in fields, so the route can validate both without trusting a client
 * supplied remnant mapping or reading the full instance document.
 */
export const LIFECYCLE_WORKFLOW_STATE_QUERY = `*[_type == "sanity.workflow.instance" && _id == $workflowInstanceId && tag == $workflowTag && definition == $workflowDefinition][0]{
  _id,
  _rev,
  tag,
  definition,
  currentStage,
  "mode": context[name == "mode"][0].value,
  "allocationUsed": fields[name == "allocationUsed"][0].value,
  "orderId": fields[name == "order"][0].value.id,
  "remnantId": fields[name == "subject"][0].value.id
}`;

const SANITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const REVISION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const REMNANT_STATUSES = new Set<WorkflowRemnantStatus>([
  "intake",
  "consented",
  "listed",
  "allocated",
  "sold-out",
  "returned",
]);
const PATCH_STATUSES = new Set<RemnantStatusPatch>(["listed", "returned", "allocated", "sold-out"]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function requiredString(value: unknown, field: string, pattern = SANITY_ID_PATTERN, maxLength = 256): string {
  if (typeof value !== "string") throw new SanityDataValidationError(`Invalid workflow state value for ${field}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || !pattern.test(normalized)) {
    throw new SanityDataValidationError(`Invalid workflow state value for ${field}`);
  }
  return normalized;
}

function nonEmptyString(value: unknown, field: string, maxLength = 256): string {
  if (typeof value !== "string") throw new SanityDataValidationError(`Invalid workflow state value for ${field}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new SanityDataValidationError(`Invalid workflow state value for ${field}`);
  }
  return normalized;
}

function finiteNumber(value: unknown, field: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new SanityDataValidationError(`Invalid workflow state value for ${field}`);
  }
  return value;
}

function rectangle(value: unknown, field: string): Rect {
  if (!isRecord(value)) throw new SanityDataValidationError(`Invalid workflow state value for ${field}`);
  return {
    x: finiteNumber(value.x, `${field}.x`, 0),
    y: finiteNumber(value.y, `${field}.y`, 0),
    w: finiteNumber(value.w, `${field}.w`, Number.MIN_VALUE),
    h: finiteNumber(value.h, `${field}.h`, Number.MIN_VALUE),
  };
}

function rectangleList(value: unknown, field: string): Rect[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SanityDataValidationError(`Invalid workflow state value for ${field}`);
  return value.map((item, index) => rectangle(item, `${field}[${index}]`));
}

function allocationOrderIds(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SanityDataValidationError(`Invalid workflow state value for ${field}`);
  return value.flatMap((item, index) => {
    if (!isRecord(item)) throw new SanityDataValidationError(`Invalid workflow state value for ${field}[${index}]`);
    const reference =
      item.orderId ??
      (isRecord(item.order) && (item.order._ref !== undefined ? item.order._ref : undefined));
    if (reference === undefined || reference === null) return [];
    return [nonEmptyString(reference, `${field}[${index}].orderId`, 256)].filter(Boolean);
  });
}

function parseRemnant(value: unknown): WorkflowRemnantState | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new SanityDataValidationError("Invalid workflow state remnant");

  const id = requiredString(value._id, "remnant._id");
  const revision = requiredString(value._rev, "remnant._rev", REVISION_ID_PATTERN);
  const rawStatus = nonEmptyString(value.status, "remnant.status", 32);
  if (!REMNANT_STATUSES.has(rawStatus as WorkflowRemnantStatus)) {
    throw new SanityDataValidationError("Invalid workflow state remnant status");
  }
  const widthCm = finiteNumber(value.widthCm, "remnant.widthCm", Number.MIN_VALUE);
  const heightCm = finiteNumber(value.heightCm, "remnant.heightCm", Number.MIN_VALUE);
  if (!isRecord(value.fabric)) throw new SanityDataValidationError("Invalid workflow state remnant fabric");
  const valuePerM = finiteNumber(value.fabric.valuePerM, "remnant.fabric.valuePerM", 0);
  const fabric = {
    name: value.fabric.name === undefined ? undefined : nonEmptyString(value.fabric.name, "remnant.fabric.name", 160),
    maker:
      value.fabric.maker === undefined ? undefined : nonEmptyString(value.fabric.maker, "remnant.fabric.maker", 160),
    valuePerM,
  };

  let patternRepeat: Remnant["repeat"] = null;
  if (value.repeat !== undefined && value.repeat !== null) {
    if (!isRecord(value.repeat)) throw new SanityDataValidationError("Invalid workflow state remnant repeat");
    patternRepeat = {
      vCm: value.repeat.vCm === undefined || value.repeat.vCm === null ? undefined : finiteNumber(value.repeat.vCm, "remnant.repeat.vCm", Number.MIN_VALUE),
      hCm: value.repeat.hCm === undefined || value.repeat.hCm === null ? undefined : finiteNumber(value.repeat.hCm, "remnant.repeat.hCm", Number.MIN_VALUE),
    };
  }
  if (typeof value.directional !== "boolean") {
    throw new SanityDataValidationError("Invalid workflow state remnant directional flag");
  }

  const ownerShareBps =
    value.ownerShareBps === undefined || value.ownerShareBps === null
      ? undefined
      : finiteNumber(value.ownerShareBps, "remnant.ownerShareBps", 0);
  if (ownerShareBps !== undefined && (!Number.isInteger(ownerShareBps) || ownerShareBps > 10_000)) {
    throw new SanityDataValidationError("Invalid workflow state owner share");
  }

  return {
    _id: id,
    _rev: revision,
    status: rawStatus as WorkflowRemnantStatus,
    widthCm,
    heightCm,
    fabric,
    repeat: patternRepeat,
    directional: value.directional,
    defects: rectangleList(value.defects, "remnant.defects"),
    allocations: rectangleList(value.allocations, "remnant.allocations"),
    allocationOrderIds: allocationOrderIds(value.allocations, "remnant.allocations"),
    ...(ownerShareBps === undefined ? {} : {ownerShareBps}),
  };
}

function parseConsentRemnantRevision(value: unknown): ConsentRemnantRevision | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new SanityDataValidationError("Invalid consent workflow remnant");
  const id = requiredString(value._id, "remnant._id");
  const revision = requiredString(value._rev, "remnant._rev", REVISION_ID_PATTERN);
  const status = nonEmptyString(value.status, "remnant.status", 32);
  if (!REMNANT_STATUSES.has(status as WorkflowRemnantStatus)) {
    throw new SanityDataValidationError("Invalid consent workflow remnant status");
  }
  return { _id: id, _rev: revision, status: status as WorkflowRemnantStatus };
}

function parseWorkflow(value: unknown, workflowTag: string): WorkflowInstanceState | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new SanityDataValidationError("Invalid workflow instance projection");
  const tag = nonEmptyString(value.tag, "workflow.tag", 64);
  if (tag !== workflowTag) throw new SanityDataValidationError("Invalid workflow instance tag");
  const definition = nonEmptyString(value.definition, "workflow.definition", 160);
  if (definition !== WORKFLOW_DEFINITION_NAME) {
    throw new SanityDataValidationError("Invalid workflow instance definition");
  }
  let settlement: WorkflowInstanceState["settlement"];
  if (value.fields !== undefined && value.fields !== null) {
    if (!Array.isArray(value.fields)) throw new SanityDataValidationError("Invalid workflow instance fields");
    for (const field of value.fields) {
      if (!isRecord(field)) throw new SanityDataValidationError("Invalid workflow instance field");
      if (field.name !== "settlement") continue;
      if (field.value === undefined || field.value === null) continue;
      if (field.value !== "listed" && field.value !== "sold-out") {
        throw new SanityDataValidationError("Invalid workflow instance settlement");
      }
      settlement = field.value;
    }
  }
  let mode: WorkflowInstanceState["mode"];
  if (value.mode !== undefined && value.mode !== null) {
    if (value.mode !== "consent" && value.mode !== "lifecycle") {
      throw new SanityDataValidationError("Invalid workflow instance mode");
    }
    mode = value.mode;
  }
  let allocationUsed: boolean | undefined;
  if (value.allocationUsed !== undefined && value.allocationUsed !== null) {
    if (typeof value.allocationUsed !== "boolean") {
      throw new SanityDataValidationError("Invalid workflow instance allocation guard");
    }
    allocationUsed = value.allocationUsed;
  }
  const orderId =
    value.orderId === undefined || value.orderId === null
      ? undefined
      : nonEmptyString(value.orderId, "workflow.orderId", 256);
  const remnantId =
    value.remnantId === undefined || value.remnantId === null
      ? undefined
      : requiredString(value.remnantId, "workflow.remnantId");
  return {
    _id: nonEmptyString(value._id, "workflow._id", 256),
    _rev:
      value._rev === undefined || value._rev === null
        ? undefined
        : requiredString(value._rev, "workflow._rev", REVISION_ID_PATTERN),
    tag,
    definition,
    currentStage: nonEmptyString(value.currentStage, "workflow.currentStage", 80),
    ...(mode === undefined ? {} : {mode}),
    ...(allocationUsed === undefined ? {} : {allocationUsed}),
    ...(orderId === undefined ? {} : {orderId}),
    ...(remnantId === undefined ? {} : {remnantId}),
    ...(settlement === undefined ? {} : {settlement}),
  };
}

function parseTemplatePiece(value: unknown, field: string): ProductTemplate["pieces"][number] {
  if (!isRecord(value)) throw new SanityDataValidationError(`Invalid workflow state value for ${field}`);
  const piece: ProductTemplate["pieces"][number] = {
    label: nonEmptyString(value.label, `${field}.label`, 80),
    wCm: finiteNumber(value.wCm, `${field}.wCm`, Number.MIN_VALUE),
    hCm: finiteNumber(value.hCm, `${field}.hCm`, Number.MIN_VALUE),
    centerPattern: value.centerPattern === true,
  };
  if (value.centerPattern !== undefined && typeof value.centerPattern !== "boolean") {
    throw new SanityDataValidationError(`Invalid workflow state value for ${field}.centerPattern`);
  }
  if (value.qty !== undefined && value.qty !== null) {
    const qty = finiteNumber(value.qty, `${field}.qty`, 1);
    if (!Number.isInteger(qty)) throw new SanityDataValidationError(`Invalid workflow state value for ${field}.qty`);
    piece.qty = qty;
  }
  return piece;
}

function parseTemplates(value: unknown): ProductTemplate[] {
  if (!Array.isArray(value)) throw new SanityDataValidationError("Invalid workflow state templates");
  return value.map((item, index) => {
    if (!isRecord(item)) throw new SanityDataValidationError(`Invalid workflow state template ${index}`);
    if (item.active !== true) throw new SanityDataValidationError(`Invalid workflow state template ${index}`);
    if (!Array.isArray(item.pieces) || item.pieces.length === 0) {
      throw new SanityDataValidationError(`Invalid workflow state template ${index} pieces`);
    }
    const template: ProductTemplate = {
      _id: requiredString(item._id, `templates[${index}]._id`),
      name: nonEmptyString(item.name, `templates[${index}].name`, 160),
      pieces: item.pieces.map((piece, pieceIndex) =>
        parseTemplatePiece(piece, `templates[${index}].pieces[${pieceIndex}]`),
      ),
      active: true,
    };
    if (item.kind !== undefined && item.kind !== null) template.kind = nonEmptyString(item.kind, `templates[${index}].kind`, 80);
    if (item.seamCm !== undefined && item.seamCm !== null) template.seamCm = finiteNumber(item.seamCm, `templates[${index}].seamCm`, 0);
    if (item.labourMin !== undefined && item.labourMin !== null) {
      template.labourMin = finiteNumber(item.labourMin, `templates[${index}].labourMin`, 0);
      if (!Number.isInteger(template.labourMin)) throw new SanityDataValidationError(`Invalid workflow state template ${index} labour`);
    }
    if (item.fillCost !== undefined && item.fillCost !== null) template.fillCost = finiteNumber(item.fillCost, `templates[${index}].fillCost`, 0);
    return template;
  });
}

function requireWorkflowTag(value: string): string {
  return nonEmptyString(value, "workflowTag", 64);
}

function requireWorkflowInstanceId(value: string): string {
  return nonEmptyString(value, "workflowInstanceId", 256);
}

export async function fetchConsentWorkflowState(
  remnantId: string,
  workflowInstanceId: string,
  workflowTag: string,
  client?: SanityReadClient,
): Promise<ConsentWorkflowState | null> {
  const id = requiredString(remnantId, "remnantId");
  const instanceId = requireWorkflowInstanceId(workflowInstanceId);
  const tag = requireWorkflowTag(workflowTag);
  const activeClient = client ?? createSanityServerClient();
  const result = await activeClient.fetch<unknown>(CONSENT_WORKFLOW_STATE_QUERY, {
    remnantId: id,
    workflowInstanceId: instanceId,
    workflowTag: tag,
    workflowDefinition: WORKFLOW_DEFINITION_NAME,
  });
  if (!isRecord(result)) throw new SanityDataValidationError("Invalid consent workflow state");
  const remnant = parseConsentRemnantRevision(result.remnant);
  if (!remnant) return null;
  if (remnant._id !== id) throw new SanityDataValidationError("Invalid consent workflow remnant mapping");
  return {remnant, workflow: parseWorkflow(result.workflow, tag)};
}

export async function fetchOrderWorkflowState(
  workflowInstanceId: string,
  workflowTag: string,
  client?: SanityReadClient,
): Promise<ProductionWorkflowState | null> {
  const instanceId = requireWorkflowInstanceId(workflowInstanceId);
  const tag = requireWorkflowTag(workflowTag);
  const activeClient = client ?? createSanityServerClient();
  const result = await activeClient.fetch<unknown>(ORDER_WORKFLOW_REMNANT_QUERY, {
    workflowInstanceId: instanceId,
    workflowTag: tag,
    workflowDefinition: WORKFLOW_DEFINITION_NAME,
  });
  if (!isRecord(result)) throw new SanityDataValidationError("Invalid order workflow state");
  const order = result.order;
  if (!isRecord(order)) return null;
  const orderId = nonEmptyString(order._id, "order._id", 256);
  const mappedInstanceId = nonEmptyString(order.workflowInstanceId, "order.workflowInstanceId", 256);
  const remnantId = requiredString(order.remnantId, "order.remnantId");
  if (mappedInstanceId !== instanceId) throw new SanityDataValidationError("Invalid order workflow mapping");
  const remnant = parseRemnant(result.remnant);
  if (remnant && remnant._id !== remnantId) {
    throw new SanityDataValidationError("Invalid order workflow remnant mapping");
  }
  const workflow = parseWorkflow(result.workflow, tag);
  if (workflow && workflow._id !== instanceId) {
    throw new SanityDataValidationError("Invalid order workflow mapping");
  }
  return {
    orderId,
    workflowInstanceId: mappedInstanceId,
    remnantId,
    remnant,
    workflow,
    templates: parseTemplates(result.templates),
  };
}

/** Fetch the minimal workflow fields needed to authorize recovery actions. */
export async function fetchLifecycleWorkflowState(
  workflowInstanceId: string,
  workflowTag: string,
  client?: SanityReadClient,
): Promise<WorkflowInstanceState | null> {
  const instanceId = requireWorkflowInstanceId(workflowInstanceId);
  const tag = requireWorkflowTag(workflowTag);
  const activeClient = client ?? createSanityServerClient();
  const result = await activeClient.fetch<unknown>(LIFECYCLE_WORKFLOW_STATE_QUERY, {
    workflowInstanceId: instanceId,
    workflowTag: tag,
    workflowDefinition: WORKFLOW_DEFINITION_NAME,
  });
  const workflow = parseWorkflow(result, tag);
  if (workflow && workflow._id !== instanceId) {
    throw new SanityDataValidationError("Invalid lifecycle workflow mapping");
  }
  return workflow;
}

/** Read an order by its stable document ID and validate its workflow binding. */
export async function fetchOrderWorkflowBinding(
  orderId: string,
  client?: SanityDocumentReadClient,
): Promise<WorkflowOrderBinding | null> {
  const id = nonEmptyString(orderId, "orderId", 256);
  const activeClient = client ?? createSanityServerClient();
  const document = await activeClient.getDocument<UnknownRecord>(id);
  if (document === null || document === undefined) return null;
  if (!isRecord(document) || document._type !== "order") {
    throw new SanityDataValidationError("Invalid workflow order projection");
  }
  const projectedId = nonEmptyString(document._id, "order._id", 256);
  if (projectedId !== id) throw new SanityDataValidationError("Invalid workflow order projection");
  const workflowInstanceId = nonEmptyString(document.workflowInstanceId, "order.workflowInstanceId", 256);
  let remnantId: string | undefined;
  if (document.remnant !== undefined && document.remnant !== null) {
    if (!isRecord(document.remnant)) throw new SanityDataValidationError("Invalid workflow order remnant mapping");
    remnantId = nonEmptyString(document.remnant._ref, "order.remnant", 256);
  }
  return {orderId: projectedId, workflowInstanceId, ...(remnantId === undefined ? {} : {remnantId})};
}

/** Apply a status transition only if the caller still owns the fetched revision. */
export async function patchRemnantStatus(
  remnantId: string,
  status: RemnantStatusPatch,
  ifRevisionId: string,
  client?: SanityPersistenceClient,
): Promise<{remnantId: string; status: RemnantStatusPatch}> {
  const id = requiredString(remnantId, "remnantId");
  const revision = requiredString(ifRevisionId, "ifRevisionId", REVISION_ID_PATTERN);
  if (!PATCH_STATUSES.has(status)) throw new SanityDataValidationError("Invalid remnant status patch");
  const activeClient = client ?? createSanityServerClient();
  const patch: PatchOperations = {
    ifRevisionID: revision,
    set: {status},
  };
  const transaction = activeClient.transaction();
  transaction.patch(id, patch);
  try {
    await transaction.commit();
  } catch (error: unknown) {
    const normalized = normalizeSanityRevisionConflict(error);
    if (isSanityRevisionConflict(normalized)) throw normalized;
    if (
      isRecord(error) &&
      (error.statusCode === 409 || error.statusCode === "409" || error.status === 409 || error.status === "409")
    ) {
      throw new SanityRevisionConflictError({cause: error});
    }
    throw error;
  }
  return {remnantId: id, status};
}

// Compatibility aliases for callers that name the projection by its subject.
export const fetchConsentRemnantState = fetchConsentWorkflowState;
export const fetchConsentRemnantRevision = fetchConsentWorkflowState;
export const fetchOrderWorkflowRemnant = fetchOrderWorkflowState;
export const fetchOrderWorkflowRemnantMapping = fetchOrderWorkflowState;
export const fetchLifecycleInstanceState = fetchLifecycleWorkflowState;
export const fetchWorkflowInstanceState = fetchLifecycleWorkflowState;
export const fetchOrderBinding = fetchOrderWorkflowBinding;
export const updateRemnantStatus = patchRemnantStatus;
export const lockRemnantStatus = patchRemnantStatus;
