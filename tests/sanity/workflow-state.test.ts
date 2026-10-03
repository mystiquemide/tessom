import {describe, expect, it} from "vitest";

import {
  CONSENT_WORKFLOW_STATE_QUERY,
  LIFECYCLE_WORKFLOW_STATE_QUERY,
  ORDER_WORKFLOW_REMNANT_QUERY,
  fetchConsentWorkflowState,
  fetchLifecycleWorkflowState,
  fetchOrderWorkflowBinding,
  fetchOrderWorkflowState,
  patchRemnantStatus,
} from "../../lib/sanity/workflow-state";
import type {SanityPersistenceClient, SanityTransaction} from "../../lib/sanity/client";
import {SanityRevisionConflictError} from "../../lib/sanity/orders";

const remnantProjection = {
  _id: "remnant-1",
  _rev: "rev-1",
  status: "allocated",
  widthCm: 100,
  heightCm: 100,
  fabric: {name: "Wool", maker: "Mill", valuePerM: 100},
  repeat: {vCm: 20, hCm: 30},
  directional: false,
  defects: [{x: 5, y: 5, w: 2, h: 2}],
  allocations: [{x: 60, y: 0, w: 40, h: 40, orderId: "orders/order-1"}],
  ownerShareBps: 2_000,
};

const workflowProjection = {
  _id: "workflow/order-1",
  _rev: "workflow-rev-1",
  tag: "tessom-dev",
  definition: "remnant-lifecycle",
  currentStage: "allocated",
};

class FakeTransaction implements SanityTransaction {
  operations: Array<{id: string; patch: Record<string, unknown>}> = [];
  commitError: unknown;

  patch(id: string, patch: Record<string, unknown>): this {
    this.operations.push({id, patch});
    return this;
  }

  create(): this {
    return this;
  }

  async commit(): Promise<unknown> {
    if (this.commitError !== undefined) throw this.commitError;
    return {transactionId: "tx-1"};
  }
}

function fakeClient(result: unknown, transaction = new FakeTransaction()): SanityPersistenceClient & {transactionValue: FakeTransaction; calls: Array<{query: string; params?: Record<string, unknown>}>} {
  const calls: Array<{query: string; params?: Record<string, unknown>}> = [];
  return {
    calls,
    transactionValue: transaction,
    transaction: () => transaction,
    fetch: async <T>(query: string, params?: Record<string, unknown>) => {
      calls.push({query, params});
      return result as T;
    },
  };
}

describe("Sanity workflow state adapter", () => {
  it("reads a narrow, tag-scoped lifecycle recovery projection", async () => {
    const client = fakeClient({
      _id: "workflow/order-1",
      _rev: "workflow-rev-1",
      tag: "tessom-dev",
      definition: "remnant-lifecycle",
      currentStage: "listed",
      mode: "lifecycle",
      allocationUsed: false,
      orderId: "orders/order-1",
      remnantId: "remnant-1",
    });

    const state = await fetchLifecycleWorkflowState("workflow/order-1", "tessom-dev", client);

    expect(client.calls[0]).toEqual({
      query: LIFECYCLE_WORKFLOW_STATE_QUERY,
      params: {
        workflowInstanceId: "workflow/order-1",
        workflowTag: "tessom-dev",
        workflowDefinition: "remnant-lifecycle",
      },
    });
    expect(LIFECYCLE_WORKFLOW_STATE_QUERY).toContain("$workflowInstanceId");
    expect(LIFECYCLE_WORKFLOW_STATE_QUERY).toContain("$workflowTag");
    expect(LIFECYCLE_WORKFLOW_STATE_QUERY).not.toContain("buyerEmail");
    expect(state).toMatchObject({
      _id: "workflow/order-1",
      mode: "lifecycle",
      allocationUsed: false,
      orderId: "orders/order-1",
      remnantId: "remnant-1",
    });
  });

  it("uses direct getDocument to validate an order workflow binding", async () => {
    const getDocument = async () => ({
      _id: "orders/order-1",
      _type: "order",
      workflowInstanceId: "workflow/order-1",
      remnant: {_ref: "remnant-1"},
    });
    const client = {getDocument} as never;

    await expect(fetchOrderWorkflowBinding("orders/order-1", client)).resolves.toEqual({
      orderId: "orders/order-1",
      workflowInstanceId: "workflow/order-1",
      remnantId: "remnant-1",
    });
  });

  it("uses parameterized GROQ and validates the narrow consent projection", async () => {
    const client = fakeClient({
      remnant: {_id: "remnant-1", _rev: "rev-1", status: "consented"},
      workflow: workflowProjection,
    });

    const state = await fetchConsentWorkflowState("remnant-1", "consent/tessom-dev/remnant-1", "tessom-dev", client);

    expect(client.calls[0]).toEqual({
      query: CONSENT_WORKFLOW_STATE_QUERY,
      params: {
        remnantId: "remnant-1",
        workflowInstanceId: "consent/tessom-dev/remnant-1",
        workflowTag: "tessom-dev",
        workflowDefinition: "remnant-lifecycle",
      },
    });
    expect(CONSENT_WORKFLOW_STATE_QUERY).toContain("$remnantId");
    expect(CONSENT_WORKFLOW_STATE_QUERY).toContain("$workflowInstanceId");
    expect(CONSENT_WORKFLOW_STATE_QUERY).not.toContain("buyerEmail");
    expect(state).toMatchObject({remnant: {_id: "remnant-1", _rev: "rev-1", status: "consented"}, workflow: workflowProjection});
  });

  it("resolves production remnant only through the persisted order mapping", async () => {
    const client = fakeClient({
      order: {_id: "orders/order-1", workflowInstanceId: "workflow/order-1", remnantId: "remnant-1"},
      workflow: {...workflowProjection, fields: [{name: "settlement", value: "listed"}]},
      remnant: remnantProjection,
      templates: [
        {
          _id: "template-1",
          name: "Cushion",
          active: true,
          pieces: [{label: "front", wCm: 40, hCm: 40}],
        },
      ],
    });

    const state = await fetchOrderWorkflowState("workflow/order-1", "tessom-dev", client);

    expect(client.calls[0].query).toBe(ORDER_WORKFLOW_REMNANT_QUERY);
    expect(client.calls[0].params).toEqual({
      workflowInstanceId: "workflow/order-1",
      workflowTag: "tessom-dev",
      workflowDefinition: "remnant-lifecycle",
    });
    expect(ORDER_WORKFLOW_REMNANT_QUERY).toContain("workflowInstanceId == $workflowInstanceId");
    expect(ORDER_WORKFLOW_REMNANT_QUERY).toContain("\"orderId\": order._ref");
    expect(state).toMatchObject({
      orderId: "orders/order-1",
      workflowInstanceId: "workflow/order-1",
      remnantId: "remnant-1",
      remnant: {_id: "remnant-1"},
      templates: [{_id: "template-1", active: true}],
    });
    expect(state?.remnant?.allocationOrderIds).toEqual(["orders/order-1"]);
    expect(state?.workflow?.settlement).toBe("listed");
  });

  it("revision locks status patches and normalizes Sanity conflicts", async () => {
    const transaction = new FakeTransaction();
    const client = fakeClient(undefined, transaction);

    await expect(patchRemnantStatus("remnant-1", "listed", "rev-1", client)).resolves.toEqual({
      remnantId: "remnant-1",
      status: "listed",
    });
    expect(transaction.operations).toEqual([
      {id: "remnant-1", patch: {ifRevisionID: "rev-1", set: {status: "listed"}}},
    ]);

    transaction.commitError = {statusCode: 409, body: {error: {type: "mutationError", items: [{error: {type: "revisionMismatch"}}]}}};
    await expect(patchRemnantStatus("remnant-1", "returned", "rev-1", client)).rejects.toBeInstanceOf(
      SanityRevisionConflictError,
    );
  });
});
