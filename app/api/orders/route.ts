import {NextResponse} from "next/server";
import {MAX_JSON_BODY_BYTES, readJsonBody} from "../../../lib/http/json-body";
import {isSanityDocumentId} from "../../../lib/http/sanity-id";

import {
  BadOrderRequestError,
  OrderConflictError,
  UnavailableOfferError,
  WorkflowAbandonError,
  WorkflowAllocationError,
  WorkflowCommitReconciliationError,
  WorkflowCommitUnconfirmedError,
  WorkflowPreparationError,
  createOrder,
  type OrderCommitInput,
  type OrderReplayRecoveryInput,
  type PrepareWorkflowInput,
} from "../../../lib/orders";
import {DEFAULT_OFFER_RATES} from "../../../lib/offers/rates";
import {
  commitAllocatedOrder,
  fetchOrderReplay,
  fetchOrderContext,
  hasCommittedOrder,
  isSanityRevisionConflict,
} from "../../../lib/sanity";
import {
  abandonPreparedLifecycleAllocation,
  allocateRemnant,
  finalizeLifecycleAllocation,
  prepareLifecycleAllocation,
  tickWorkflowInstance,
  UnusableLifecycleInstanceError,
  type PreparedLifecycleAllocation,
} from "../../../lib/workflow";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const NO_STORE_HEADERS = {"Cache-Control": "no-store"};

class MissingServerConfigurationError extends Error {
  constructor() {
    super("Required server configuration is unavailable");
    this.name = "MissingServerConfigurationError";
  }
}

function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await readJsonBody(request, MAX_JSON_BODY_BYTES);
  } catch {
    throw new BadOrderRequestError("The request body could not be read");
  }
}

function hasValidDocumentIds(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const value = input as {remnantId?: unknown; templateId?: unknown};
  return isSanityDocumentId(value.remnantId) && isSanityDocumentId(value.templateId);
}

function toCommitInput(input: OrderCommitInput) {
  return {
    orderId: input.orderId,
    remnantId: input.remnantId,
    ifRevisionId: input.ifRevisionId,
    templateId: input.templateId,
    idempotencyKey: input.idempotencyKey,
    placement: input.placement,
    price: input.price,
    ownerShare: input.ownerShare,
    buyerName: input.order.buyerName,
    buyerEmail: input.order.buyerEmail,
    workflowInstanceId: input.order.workflowInstanceId,
    createdAt: input.order.createdAt,
  };
}

function workflowIdempotencyKey(orderId: string): string {
  return `${orderId}:allocation`;
}

function isConflictLike(error: unknown): boolean {
  if (isSanityRevisionConflict(error)) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as {code?: unknown; status?: unknown; statusCode?: unknown};
  return (
    candidate.code === "CONFLICT" ||
    candidate.code === "conflict" ||
    candidate.status === 409 ||
    candidate.statusCode === 409
  );
}

function isConfirmedOptimisticConflict(error: unknown): boolean {
  if (isSanityRevisionConflict(error)) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as {code?: unknown; message?: unknown; status?: unknown; statusCode?: unknown};
  if (
    candidate.code === "SANITY_REVISION_CONFLICT" ||
    candidate.code === "CONFLICT" ||
    candidate.code === "conflict"
  ) {
    return true;
  }
  const status = candidate.status ?? candidate.statusCode;
  return (
    (status === 409 || status === "409") &&
    typeof candidate.message === "string" &&
    /revision|stale|document changed|transaction.*abort|already exists|duplicate|create.*conflict/i.test(candidate.message)
  );
}

function isMissingConfiguration(error: unknown, seen = new Set<unknown>()): boolean {
  if (seen.has(error)) return false;
  if (error instanceof MissingServerConfigurationError) return true;
  if (!(error instanceof Error)) return false;
  seen.add(error);
  if (/missing required environment variable|server configuration is unavailable/i.test(error.message)) return true;
  return isMissingConfiguration((error as Error & {cause?: unknown}).cause, seen);
}

function replayInput(input: OrderCommitInput) {
  return {
    orderId: input.orderId,
    remnantId: input.remnantId,
    templateId: input.templateId,
    buyerName: input.order.buyerName,
    buyerEmail: input.order.buyerEmail,
    idempotencyKey: input.idempotencyKey,
  };
}

function replayResult(value: Awaited<ReturnType<typeof fetchOrderReplay>>) {
  if (value.status !== "matched") return undefined;
  return {
    orderId: value.orderId,
    workflowInstanceId: value.workflowInstanceId,
    remnantId: value.remnantId,
    templateId: value.templateId,
    placement: value.placement.map((piece) => ({...piece})),
    usedArea: value.usedArea,
    price: value.price,
    ownerShare: value.ownerShare,
    createdAt: value.createdAt,
  };
}

async function abandonPrepared(
  prepared: PreparedLifecycleAllocation,
  orderId: string,
): Promise<void> {
  try {
    const abandoned = await abandonPreparedLifecycleAllocation(prepared, {
      idempotencyKey: `${workflowIdempotencyKey(orderId)}:${prepared.instanceId}:abandon`,
      idempotent: true,
    });
    if (abandoned === undefined) throw new Error("Workflow abandon returned no operation result");
  } catch (error) {
    throw new WorkflowAbandonError(orderId, prepared.instanceId, error);
  }
}

async function completePersistedWorkflow(orderId: string, workflowInstanceId: string): Promise<void> {
  try {
    await allocateRemnant(workflowInstanceId, {
      idempotencyKey: workflowIdempotencyKey(orderId),
      idempotent: true,
    });
    await tickWorkflowInstance(workflowInstanceId, {
      idempotencyKey: workflowIdempotencyKey(orderId),
      idempotent: true,
    });
  } catch (error) {
    throw new WorkflowAllocationError(orderId, workflowInstanceId, error);
  }
}

function dependencies() {
  const preparedByWorkflowId = new Map<string, PreparedLifecycleAllocation>();

  return {
    loadOrderContext: fetchOrderContext,
    loadOrderReplay: fetchOrderReplay,
    recoverReplay: async ({orderId, workflowInstanceId}: OrderReplayRecoveryInput) => {
      await completePersistedWorkflow(orderId, workflowInstanceId);
    },
    rates: DEFAULT_OFFER_RATES,
    prepareWorkflow: async (input: PrepareWorkflowInput) => {
      let prepared: PreparedLifecycleAllocation | undefined;
      try {
        prepared = await prepareLifecycleAllocation(input.remnantId, {
          orderId: input.orderId,
          allocation: input.placement,
          instanceId: input.workflowInstanceId,
          idempotencyKey: workflowIdempotencyKey(input.orderId),
          idempotent: true,
        });
      } catch (error) {
        if (isMissingConfiguration(error)) throw new MissingServerConfigurationError();
        if (error instanceof UnusableLifecycleInstanceError) {
          throw new WorkflowAbandonError(input.orderId, error.instanceId);
        }
        throw error;
      }
      if (!prepared) throw new MissingServerConfigurationError();
      preparedByWorkflowId.set(prepared.instanceId, prepared);
      return {workflowInstanceId: prepared.instanceId};
    },
    commitOrder: async (input: OrderCommitInput) => {
      const prepared = preparedByWorkflowId.get(input.order.workflowInstanceId);
      if (!prepared) throw new WorkflowPreparationError();

      let outcome;
      try {
        outcome = await finalizeLifecycleAllocation(
          prepared,
          async () => commitAllocatedOrder(toCommitInput(input)),
          {
            idempotencyKey: workflowIdempotencyKey(input.orderId),
            idempotent: true,
          },
        );
      } catch (error) {
        throw new WorkflowAllocationError(input.orderId, prepared.instanceId, error);
      }

      if (outcome.committed) return {committed: true};

      let committed: boolean;
      try {
        committed = await hasCommittedOrder(input.orderId);
      } catch (error) {
        // A confirmed optimistic conflict can still be mapped safely when the
        // environment itself is missing. An ambiguous write stays unknown and
        // keeps its original failure without touching the prepared guard.
        if (isMissingConfiguration(error)) {
          if (isConfirmedOptimisticConflict(outcome.error)) {
            await abandonPrepared(prepared, input.orderId);
            return false;
          }
          throw outcome.error;
        }
        throw new WorkflowCommitReconciliationError(input.orderId, prepared.instanceId, error);
      }

      if (committed) {
        let replay;
        try {
          replay = await fetchOrderReplay(replayInput(input));
        } catch (error) {
          throw new WorkflowCommitReconciliationError(input.orderId, prepared.instanceId, error);
        }
        const persisted = replayResult(replay);
        if (!persisted) {
          if (replay.status === "mismatch") {
            await abandonPrepared(prepared, input.orderId);
            return false;
          }
          throw new WorkflowCommitReconciliationError(input.orderId, prepared.instanceId);
        }
        if (persisted.workflowInstanceId !== prepared.instanceId) {
          await abandonPrepared(prepared, input.orderId);
        }
        await completePersistedWorkflow(input.orderId, persisted.workflowInstanceId);
        return {committed: true, existing: true, replay: persisted};
      }

      await abandonPrepared(prepared, input.orderId);
      if (isConfirmedOptimisticConflict(outcome.error)) return false;
      throw new WorkflowCommitUnconfirmedError(input.orderId, prepared.instanceId, outcome.error);
    },
    // Finalization is performed by finalizeLifecycleAllocation around the commit.
    allocate: async () => undefined,
  };
}

function responseForError(error: unknown): NextResponse {
  if (error instanceof BadOrderRequestError) {
    return jsonResponse({error: "Invalid order request"}, 400);
  }
  if (error instanceof UnavailableOfferError || error instanceof OrderConflictError) {
    return jsonResponse({error: error.message}, 409);
  }
  if (error instanceof WorkflowAbandonError) {
    return jsonResponse(
      {
        error: error.message,
        orderId: error.orderId,
        workflowInstanceId: error.workflowInstanceId,
        recoveryRequired: error.recoveryRequired,
        recoveryAction: error.recoveryAction,
      },
      503,
    );
  }
  if (error instanceof WorkflowPreparationError) {
    return jsonResponse({error: "The order workflow could not be prepared", retryable: true}, 503);
  }
  if (error instanceof WorkflowAllocationError) {
    return jsonResponse(
      {
        error: "The order was saved but workflow activation is pending",
        orderId: error.orderId,
        workflowInstanceId: error.workflowInstanceId,
        recoveryRequired: error.recoveryRequired,
        recoveryAction: error.recoveryAction,
      },
      503,
    );
  }
  if (error instanceof WorkflowCommitReconciliationError) {
    return jsonResponse(
      {
        error: error.message,
        orderId: error.orderId,
        workflowInstanceId: error.workflowInstanceId,
        recoveryRequired: error.recoveryRequired,
        recoveryAction: error.recoveryAction,
      },
      503,
    );
  }
  if (error instanceof WorkflowCommitUnconfirmedError) {
    return jsonResponse({error: "Unable to confirm order commit", retryable: true}, 503);
  }
  if (isConflictLike(error)) {
    return jsonResponse({error: "The remnant changed while the order was being placed"}, 409);
  }
  if (isMissingConfiguration(error)) {
    return jsonResponse({error: "Order service is unavailable"}, 503);
  }
  return jsonResponse({error: "Unable to place order"}, 500);
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const input = await parseJsonBody(request);
    if (!hasValidDocumentIds(input)) throw new BadOrderRequestError("Invalid order request");
    const result = await createOrder(input, dependencies());
    return jsonResponse(result);
  } catch (error) {
    return responseForError(error);
  }
}
