import {beforeEach, describe, expect, it, vi} from "vitest";

import {MAX_JSON_BODY_BYTES} from "../../lib/http/json-body";
import {SanityRevisionConflictError} from "../../lib/sanity/orders";
import {consentInstanceId} from "../../lib/workflow";
import type {ConsentWorkflowState, ProductionWorkflowState, WorkflowRemnantState} from "../../lib/sanity/workflow-state";
import {POST} from "../../app/api/workflow/advance/route";

vi.mock("../../lib/sanity/workflow-state", () => ({
  fetchConsentWorkflowState: vi.fn(),
  fetchLifecycleWorkflowState: vi.fn(),
  fetchOrderWorkflowBinding: vi.fn(),
  fetchOrderWorkflowState: vi.fn(),
  patchRemnantStatus: vi.fn(),
}));

vi.mock("../../lib/workflow", () => ({
  consentInstanceId: vi.fn((remnantId: string, tag: string) => `consent/${tag}/${remnantId}`),
  abandonLifecycleAllocation: vi.fn(),
  grantConsent: vi.fn(),
  declineConsent: vi.fn(),
  markCut: vi.fn(),
  markSewn: vi.fn(),
  markShipped: vi.fn(),
  returnShippedToListed: vi.fn(),
  closeShippedAsSoldOut: vi.fn(),
  allocateRemnant: vi.fn(),
  tickWorkflowInstance: vi.fn(),
  workflowTagFromEnvironment: vi.fn(() => "tessom-dev"),
  WORKFLOW_DEFINITION_NAME: "remnant-lifecycle",
}));

import {
  fetchConsentWorkflowState,
  fetchLifecycleWorkflowState,
  fetchOrderWorkflowBinding,
  fetchOrderWorkflowState,
  patchRemnantStatus,
} from "../../lib/sanity/workflow-state";
import {
  closeShippedAsSoldOut,
  allocateRemnant,
  abandonLifecycleAllocation,
  declineConsent,
  grantConsent,
  markCut,
  markSewn,
  markShipped,
  returnShippedToListed,
  tickWorkflowInstance,
} from "../../lib/workflow";

const mockedFetchConsent = vi.mocked(fetchConsentWorkflowState);
const mockedFetchLifecycle = vi.mocked(fetchLifecycleWorkflowState);
const mockedFetchBinding = vi.mocked(fetchOrderWorkflowBinding);
const mockedFetchOrder = vi.mocked(fetchOrderWorkflowState);
const mockedPatchStatus = vi.mocked(patchRemnantStatus);
const mockedGrant = vi.mocked(grantConsent);
const mockedDecline = vi.mocked(declineConsent);
const mockedCut = vi.mocked(markCut);
const mockedSewn = vi.mocked(markSewn);
const mockedShipped = vi.mocked(markShipped);
const mockedListed = vi.mocked(returnShippedToListed);
const mockedSoldOut = vi.mocked(closeShippedAsSoldOut);
const mockedTick = vi.mocked(tickWorkflowInstance);
const mockedAbandon = vi.mocked(abandonLifecycleAllocation);

const remnant = (overrides: Partial<WorkflowRemnantState> = {}) => ({
  _id: "remnant-1",
  _rev: "rev-1",
  status: "allocated" as const,
  widthCm: 100,
  heightCm: 100,
  fabric: {valuePerM: 100},
  repeat: null,
  directional: false,
  defects: [],
  allocations: [],
  ...overrides,
});

const workflow = {
  tag: "tessom-dev",
  definition: "remnant-lifecycle",
  currentStage: "allocated",
  _id: "wf-1",
  mode: "lifecycle" as const,
};

const consentState = (overrides: Partial<ConsentWorkflowState> = {}): ConsentWorkflowState => ({
  remnant: remnant({status: "consented"}),
  workflow: {...workflow, currentStage: "awaiting-consent"},
  ...overrides,
});

const productionState = (overrides: Partial<ProductionWorkflowState> = {}): ProductionWorkflowState => ({
  orderId: "orders/order-1",
  workflowInstanceId: "workflow.order-1",
  remnantId: "remnant-1",
  remnant: remnant(),
  workflow,
  templates: [
    {
      _id: "template-cushion",
      name: "Cushion",
      pieces: [{label: "front", wCm: 40, hCm: 40}],
      labourMin: 10,
      active: true,
    },
  ],
  ...overrides,
});

function request(body: unknown, pin = "workshop-secret", headers: Record<string, string> = {}) {
  return new Request("https://tessom.test/api/workflow/advance", {
    method: "POST",
    headers: {"content-type": "application/json", "x-workshop-pin": pin, ...headers},
    body: JSON.stringify(body),
  });
}

function streamingRequest(headers: Record<string, string>) {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(MAX_JSON_BODY_BYTES));
    },
    cancel() {
      cancelled = true;
    },
  });
  const init = {
    method: "POST",
    headers: {"x-workshop-pin": "workshop-secret", ...headers},
    body,
    duplex: "half",
  } as RequestInit;
  return {
    request: new Request("https://tessom.test/api/workflow/advance", init),
    pulls: () => pulls,
    cancelled: () => cancelled,
  };
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("POST /api/workflow/advance", () => {
  beforeEach(() => {
    process.env.WORKSHOP_PIN = "workshop-secret";
    mockedFetchConsent.mockReset();
    mockedFetchLifecycle.mockReset();
    mockedFetchBinding.mockReset();
    mockedFetchOrder.mockReset();
    mockedPatchStatus.mockReset().mockResolvedValue({remnantId: "remnant-1", status: "listed"});
    mockedGrant.mockReset().mockResolvedValue({instance: {currentStage: "listed"}} as never);
    mockedDecline.mockReset().mockResolvedValue({instance: {currentStage: "returned"}} as never);
    mockedCut.mockReset().mockResolvedValue({instance: {currentStage: "cut"}} as never);
    mockedSewn.mockReset().mockResolvedValue({instance: {currentStage: "sewn"}} as never);
    mockedShipped.mockReset().mockResolvedValue({instance: {currentStage: "shipped"}} as never);
    mockedListed.mockReset().mockResolvedValue({instance: {currentStage: "listed"}} as never);
    mockedSoldOut.mockReset().mockResolvedValue({instance: {currentStage: "sold-out"}} as never);
    vi.mocked(allocateRemnant).mockReset().mockResolvedValue({instance: {currentStage: "allocated"}} as never);
    mockedAbandon.mockReset().mockResolvedValue({
      instance: {
        currentStage: "listed",
        fields: [{name: "allocationUsed", value: true}],
      },
    } as never);
    mockedTick.mockReset().mockResolvedValue({instance: {currentStage: "listed"}} as never);
  });

  it("requires the server PIN and only reads x-workshop-pin", async () => {
    const missing = await POST(request({action: "grant", remnantId: "remnant-1"}, ""));
    expect(missing.status).toBe(401);

    const wrongHeader = await POST(
      request({action: "grant", remnantId: "remnant-1"}, "wrong-pin", {authorization: "workshop-secret"}),
    );
    expect(wrongHeader.status).toBe(401);

    delete process.env.WORKSHOP_PIN;
    const unavailable = await POST(request({action: "grant", remnantId: "remnant-1"}));
    expect(unavailable.status).toBe(503);
    expect(await json(unavailable)).toEqual({error: "Workflow service is unavailable"});
  });

  it("returns unavailable for a weak configured PIN", async () => {
    process.env.WORKSHOP_PIN = "short";
    const response = await POST(request({action: "grant", remnantId: "remnant-1"}));
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({error: "Workflow service is unavailable"});
  });

  it("rejects arbitrary activity and action pairs", async () => {
    const response = await POST(
      request({action: "allocate", activity: "allocate", instanceId: "workflow.order-1"}),
    );
    expect(response.status).toBe(400);
    expect(mockedFetchOrder).not.toHaveBeenCalled();
  });

  it("rejects malformed Sanity IDs before reading workflow state", async () => {
    const consent = await POST(request({action: "grant", remnantId: "bad id"}));
    const production = await POST(request({action: "mark-cut", workflowInstanceId: "bad id"}));

    expect(consent.status).toBe(400);
    expect(production.status).toBe(400);
    expect(mockedFetchConsent).not.toHaveBeenCalled();
    expect(mockedFetchOrder).not.toHaveBeenCalled();
  });

  it("stops reading a streamed body at the byte limit without Content-Length", async () => {
    const tracked = streamingRequest({"content-type": "application/json"});

    const response = await POST(tracked.request);

    expect(response.status).toBe(400);
    expect(tracked.cancelled()).toBe(true);
    expect(tracked.pulls()).toBeLessThan(20);
    expect(mockedFetchConsent).not.toHaveBeenCalled();
    expect(mockedFetchOrder).not.toHaveBeenCalled();
  });

  it("enforces the stream limit when Content-Length is dishonest", async () => {
    const tracked = streamingRequest({"content-type": "application/json", "content-length": "1"});

    const response = await POST(tracked.request);

    expect(response.status).toBe(400);
    expect(tracked.cancelled()).toBe(true);
    expect(tracked.pulls()).toBeLessThan(20);
    expect(mockedFetchConsent).not.toHaveBeenCalled();
    expect(mockedFetchOrder).not.toHaveBeenCalled();
  });

  it("binds consent to the configured deterministic instance and revision locks the remnant", async () => {
    mockedFetchConsent.mockResolvedValue(consentState());

    const response = await POST(request({action: "grant", remnantId: "remnant-1", idempotencyKey: "consent-1"}));

    expect(response.status).toBe(200);
    expect(mockedFetchConsent).toHaveBeenCalledWith(
      "remnant-1",
      consentInstanceId("remnant-1", "tessom-dev"),
      "tessom-dev",
    );
    expect(mockedGrant).toHaveBeenCalledWith("consent/tessom-dev/remnant-1", {
      idempotencyKey: "consent/tessom-dev/remnant-1:grant:consent-1",
      idempotent: true,
    });
    expect(mockedPatchStatus).toHaveBeenCalledWith("remnant-1", "listed", "rev-1");
    expect(await json(response)).toMatchObject({action: "grant", remnantId: "remnant-1", status: "listed"});
  });

  it("maps missing records to 404 and missing workflow instances to 503", async () => {
    mockedFetchOrder.mockResolvedValueOnce(null);
    const missingOrder = await POST(request({action: "mark-cut", workflowInstanceId: "workflow.missing"}));
    expect(missingOrder.status).toBe(404);

    mockedFetchConsent.mockResolvedValueOnce(consentState({workflow: null}));
    const missingWorkflow = await POST(request({action: "grant", remnantId: "remnant-1"}));
    expect(missingWorkflow.status).toBe(503);
    expect(await json(missingWorkflow)).toEqual({error: "Workflow service is unavailable"});
  });

  it("rejects consent cross-actions and impossible stage/status pairs before mutating", async () => {
    mockedFetchConsent.mockResolvedValue(
      consentState({workflow: {...workflow, currentStage: "listed"}, remnant: remnant({status: "consented"})}),
    );

    const crossAction = await POST(request({action: "decline", remnantId: "remnant-1"}));
    expect(crossAction.status).toBe(409);
    expect(mockedDecline).not.toHaveBeenCalled();
    expect(mockedPatchStatus).not.toHaveBeenCalled();

    mockedFetchConsent.mockResolvedValue(
      consentState({workflow: {...workflow, currentStage: "awaiting-consent"}, remnant: remnant({status: "listed"})}),
    );
    const impossible = await POST(request({action: "grant", remnantId: "remnant-1"}));
    expect(impossible.status).toBe(409);
    expect(mockedGrant).not.toHaveBeenCalled();
  });

  it("reconciles a grant retry after the workflow reached listed", async () => {
    mockedFetchConsent.mockResolvedValue(
      consentState({workflow: {...workflow, currentStage: "listed"}, remnant: remnant({status: "consented"})}),
    );

    const response = await POST(request({action: "grant", remnantId: "remnant-1"}));

    expect(response.status).toBe(200);
    expect(mockedGrant).not.toHaveBeenCalled();
    expect(mockedPatchStatus).toHaveBeenCalledWith("remnant-1", "listed", "rev-1");
  });

  it("derives production remnant mapping from the order record", async () => {
    mockedFetchOrder.mockResolvedValue(productionState());

    const response = await POST(request({action: "mark-cut", workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(200);
    expect(mockedFetchOrder).toHaveBeenCalledWith("workflow.order-1", "tessom-dev");
    expect(mockedCut).toHaveBeenCalledWith("workflow.order-1", expect.objectContaining({idempotent: true}));
    expect(mockedPatchStatus).not.toHaveBeenCalled();
    expect(await json(response)).toMatchObject({action: "mark-cut", remnantId: "remnant-1", status: "allocated"});
  });

  it("recovers a committed allocation when its workflow is still listed", async () => {
    mockedFetchOrder.mockResolvedValue(
      productionState({
        workflow: {...workflow, currentStage: "listed"},
        remnant: remnant({status: "allocated", allocationOrderIds: ["orders/order-1"]}),
      }),
    );

    const response = await POST(request({action: "allocate", workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(200);
    expect(allocateRemnant).toHaveBeenCalledWith(
      "workflow.order-1",
      expect.objectContaining({idempotent: true}),
    );
    expect(mockedTick).toHaveBeenCalledOnce();
    expect(await json(response)).toMatchObject({action: "allocate", stage: "allocated"});
  });

  it("abandons a prepared lifecycle instance and verifies the persisted guard", async () => {
    const prepared = {
      ...workflow,
      _id: "workflow.order-1",
      currentStage: "listed",
      mode: "lifecycle" as const,
      allocationUsed: false,
      orderId: "order-1",
    };
    const abandoned = {...prepared, allocationUsed: true};
    mockedFetchLifecycle.mockResolvedValueOnce(prepared).mockResolvedValueOnce(abandoned);

    const response = await POST(request({action: "abandon", workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(200);
    expect(mockedAbandon).toHaveBeenCalledWith("workflow.order-1", {
      idempotencyKey: "workflow.order-1:abandon:default",
      idempotent: true,
    });
    expect(await json(response)).toMatchObject({
      action: "abandon",
      workflowInstanceId: "workflow.order-1",
      stage: "listed",
      allocationUsed: true,
    });
  });

  it("treats an already abandoned listed instance as an idempotent success", async () => {
    mockedFetchLifecycle.mockResolvedValue({
      ...workflow,
      _id: "workflow.order-1",
      currentStage: "listed",
      mode: "lifecycle",
      allocationUsed: true,
    });

    const response = await POST(request({action: "abandon", workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(200);
    expect(mockedAbandon).not.toHaveBeenCalled();
    expect(await json(response)).toMatchObject({action: "abandon", allocationUsed: true, stage: "listed"});
  });

  it.each([
    {currentStage: "allocated", allocationUsed: false},
    {currentStage: "listed", allocationUsed: undefined},
    {currentStage: "listed", allocationUsed: false, mode: "consent" as const},
  ])("rejects an unsafe prepared workflow state", async (state) => {
    mockedFetchLifecycle.mockResolvedValue({
      ...workflow,
      _id: "workflow.order-1",
      mode: "lifecycle",
      ...state,
    });

    const response = await POST(request({action: "abandon", workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(409);
    expect(mockedAbandon).not.toHaveBeenCalled();
  });

  it("reconciles a committed order through the shared persisted allocation recovery", async () => {
    mockedFetchBinding.mockResolvedValue({
      orderId: "order-1",
      workflowInstanceId: "workflow.order-1",
      remnantId: "remnant-1",
    });
    mockedFetchOrder.mockResolvedValue(
      productionState({
        orderId: "order-1",
        workflow: {...workflow, currentStage: "listed"},
        remnant: remnant({allocationOrderIds: ["order-1"]}),
      }),
    );

    const response = await POST(
      request({action: "reconcile", orderId: "order-1", workflowInstanceId: "workflow.order-1"}),
    );

    expect(response.status).toBe(200);
    expect(mockedFetchBinding).toHaveBeenCalledWith("order-1");
    expect(allocateRemnant).toHaveBeenCalledWith("workflow.order-1", expect.objectContaining({idempotent: true}));
    expect(await json(response)).toMatchObject({action: "reconcile", orderId: "order-1", stage: "allocated"});
  });

  it("reconciles an absent order by abandoning its prepared workflow", async () => {
    const prepared = {
      ...workflow,
      _id: "workflow.order-1",
      currentStage: "listed",
      mode: "lifecycle" as const,
      allocationUsed: false,
      orderId: "order-1",
    };
    mockedFetchBinding.mockResolvedValue(null);
    mockedFetchLifecycle.mockResolvedValueOnce(prepared).mockResolvedValueOnce({...prepared, allocationUsed: true});

    const response = await POST(
      request({action: "reconcile", orderId: "order-1", workflowInstanceId: "workflow.order-1"}),
    );

    expect(response.status).toBe(200);
    expect(mockedAbandon).toHaveBeenCalledOnce();
    expect(await json(response)).toMatchObject({action: "reconcile", orderId: "order-1", allocationUsed: true});
  });

  it("rejects an order and workflow binding mismatch before recovery", async () => {
    mockedFetchBinding.mockResolvedValue({
      orderId: "order-1",
      workflowInstanceId: "workflow.other",
      remnantId: "remnant-1",
    });

    const response = await POST(
      request({action: "reconcile", orderId: "order-1", workflowInstanceId: "workflow.order-1"}),
    );

    expect(response.status).toBe(409);
    expect(mockedFetchOrder).not.toHaveBeenCalled();
    expect(mockedAbandon).not.toHaveBeenCalled();
  });

  it("treats an allocated or later recovery as already successful", async () => {
    mockedFetchOrder.mockResolvedValue(
      productionState({
        workflow: {...workflow, currentStage: "cut"},
        remnant: remnant({status: "allocated", allocationOrderIds: ["orders/order-1"]}),
      }),
    );

    const response = await POST(request({action: "allocate", workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(200);
    expect(allocateRemnant).not.toHaveBeenCalled();
    expect(mockedTick).not.toHaveBeenCalled();
    expect(await json(response)).toMatchObject({action: "allocate", stage: "cut"});
  });

  it("moves cut to sewn through the typed helper and ticks it", async () => {
    mockedFetchOrder.mockResolvedValue(productionState({workflow: {...workflow, currentStage: "cut"}}));
    mockedTick.mockResolvedValueOnce({instance: {currentStage: "sewn"}} as never);

    const response = await POST(request({action: "mark-sewn", workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(200);
    expect(mockedSewn).toHaveBeenCalledOnce();
    expect(mockedTick).toHaveBeenCalledOnce();
    expect(await json(response)).toMatchObject({action: "mark-sewn", stage: "sewn"});
  });

  it("settles shipped remnants as listed when an offer remains", async () => {
    mockedFetchOrder.mockResolvedValue(productionState({workflow: {...workflow, currentStage: "sewn"}}));

    const response = await POST(request({action: "mark-shipped", workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(200);
    expect(mockedShipped).toHaveBeenCalledOnce();
    expect(mockedPatchStatus).toHaveBeenCalledWith("remnant-1", "listed", "rev-1");
    expect(mockedListed).toHaveBeenCalledWith("workflow.order-1", expect.objectContaining({idempotent: true}));
    expect(mockedSoldOut).not.toHaveBeenCalled();
    expect(mockedTick).toHaveBeenCalledTimes(2);
    expect(await json(response)).toMatchObject({status: "listed", remnantId: "remnant-1"});
  });

  it("settles shipped remnants as sold out when no offer remains", async () => {
    mockedFetchOrder.mockResolvedValue(
      productionState({
        workflow: {...workflow, currentStage: "sewn"},
        remnant: remnant({allocations: [{x: 0, y: 0, w: 100, h: 100}]}),
      }),
    );

    const response = await POST(request({action: "mark-shipped", workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(200);
    expect(mockedPatchStatus).toHaveBeenCalledWith("remnant-1", "sold-out", "rev-1");
    expect(mockedSoldOut).toHaveBeenCalledOnce();
    expect(mockedListed).not.toHaveBeenCalled();
    expect(await json(response)).toMatchObject({status: "sold-out"});
  });

  it("settles a shipped-stage retry without firing mark-shipped again", async () => {
    mockedFetchOrder.mockResolvedValue(productionState({workflow: {...workflow, currentStage: "shipped"}}));

    const response = await POST(request({action: "mark-shipped", workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(200);
    expect(mockedShipped).not.toHaveBeenCalled();
    expect(mockedListed).toHaveBeenCalledOnce();
    expect(await json(response)).toMatchObject({status: "listed", stage: "listed"});
  });

  it("preserves a later allocation after a listed settlement consumes the last offer", async () => {
    const settled = {...workflow, currentStage: "listed", settlement: "listed" as const};
    const before = productionState({workflow: settled});
    const after = productionState({
      workflow: settled,
      remnant: remnant({
        status: "allocated",
        allocations: [{x: 0, y: 0, w: 100, h: 100}],
        allocationOrderIds: ["orders/order-2"],
      }),
    });
    mockedFetchOrder.mockResolvedValueOnce(before).mockResolvedValueOnce(after);

    const response = await POST(request({action: "mark-shipped", workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(200);
    expect(mockedListed).not.toHaveBeenCalled();
    expect(mockedSoldOut).not.toHaveBeenCalled();
    expect(mockedPatchStatus).not.toHaveBeenCalled();
    expect(await json(response)).toMatchObject({status: "allocated", stage: "listed"});
  });

  it("reconciles a listed settlement when current availability still has an offer", async () => {
    const settled = {...workflow, currentStage: "listed", settlement: "listed" as const};
    mockedFetchOrder.mockResolvedValue(
      productionState({
        workflow: settled,
        remnant: remnant({status: "allocated", allocations: [{x: 0, y: 0, w: 60, h: 100}]}),
      }),
    );

    const response = await POST(request({action: "mark-shipped", workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(200);
    expect(mockedPatchStatus).toHaveBeenCalledWith("remnant-1", "listed", "rev-1");
    expect(await json(response)).toMatchObject({status: "listed", stage: "listed"});
  });

  it("reconciles sold-out only when current availability remains sold out", async () => {
    const settled = {...workflow, currentStage: "sold-out", settlement: "sold-out" as const};
    const soldOut = productionState({
      workflow: settled,
      remnant: remnant({status: "allocated", allocations: [{x: 0, y: 0, w: 100, h: 100}]}),
    });
    mockedFetchOrder.mockResolvedValue(soldOut);

    const response = await POST(request({action: "mark-shipped", workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(200);
    expect(mockedPatchStatus).toHaveBeenCalledWith("remnant-1", "sold-out", "rev-1");
    expect(mockedSoldOut).not.toHaveBeenCalled();
    expect(await json(response)).toMatchObject({status: "sold-out", stage: "sold-out"});
  });

  it("does not reconcile sold-out over newly available offers", async () => {
    const settled = {...workflow, currentStage: "sold-out", settlement: "sold-out" as const};
    mockedFetchOrder.mockResolvedValue(
      productionState({
        workflow: settled,
        remnant: remnant({status: "listed", allocations: [{x: 0, y: 0, w: 60, h: 100}]}),
      }),
    );

    const response = await POST(request({action: "mark-shipped", workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(200);
    expect(mockedPatchStatus).not.toHaveBeenCalled();
    expect(await json(response)).toMatchObject({status: "listed", stage: "sold-out"});
  });

  it.each([
    ["mark-cut", "allocated"],
    ["mark-sewn", "cut"],
    ["mark-shipped", "sewn"],
  ] as const)("blocks %s when the remnant is not allocated", async (action, currentStage) => {
    mockedFetchOrder.mockResolvedValue(
      productionState({workflow: {...workflow, currentStage}, remnant: remnant({status: "listed"})}),
    );

    const response = await POST(request({action, workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(409);
    expect(mockedCut).not.toHaveBeenCalled();
    expect(mockedSewn).not.toHaveBeenCalled();
    expect(mockedShipped).not.toHaveBeenCalled();
  });

  it("uses the refreshed remnant snapshot before choosing settlement", async () => {
    const before = productionState({workflow: {...workflow, currentStage: "sewn"}});
    const after = productionState({
      workflow: {...workflow, currentStage: "sewn"},
      remnant: remnant({allocations: [{x: 0, y: 0, w: 100, h: 100}]}),
    });
    mockedFetchOrder.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    mockedSoldOut.mockResolvedValue({instance: {currentStage: "sold-out"}} as never);
    mockedTick.mockResolvedValueOnce({instance: {currentStage: "shipped"}} as never).mockResolvedValueOnce({instance: {currentStage: "sold-out"}} as never);

    const response = await POST(request({action: "mark-shipped", workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(200);
    expect(mockedListed).not.toHaveBeenCalled();
    expect(mockedSoldOut).toHaveBeenCalledOnce();
    expect(mockedPatchStatus).toHaveBeenCalledWith("remnant-1", "sold-out", "rev-1");
  });

  it("settles before patching status", async () => {
    mockedFetchOrder.mockResolvedValue(productionState({workflow: {...workflow, currentStage: "sewn"}}));
    mockedTick.mockResolvedValueOnce({instance: {currentStage: "shipped"}} as never).mockResolvedValueOnce({instance: {currentStage: "listed"}} as never);
    const events: string[] = [];
    mockedListed.mockImplementation(async () => {
      events.push("settle");
      return {instance: {currentStage: "listed"}} as never;
    });
    mockedPatchStatus.mockImplementation(async () => {
      events.push("patch");
      return {remnantId: "remnant-1", status: "listed"};
    });

    const response = await POST(request({action: "mark-shipped", workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(200);
    expect(events).toEqual(["settle", "patch"]);
  });

  it("rejects a listed retry when the persisted settlement field is missing", async () => {
    mockedFetchOrder.mockResolvedValue(
      productionState({workflow: {...workflow, currentStage: "listed"}, remnant: remnant({status: "allocated"})}),
    );

    const response = await POST(request({action: "mark-shipped", workflowInstanceId: "workflow.order-1"}));

    expect(response.status).toBe(409);
    expect(mockedShipped).not.toHaveBeenCalled();
    expect(mockedListed).not.toHaveBeenCalled();
    expect(mockedPatchStatus).not.toHaveBeenCalled();
  });

  it("maps revision conflicts to 409 and keeps retry keys stable", async () => {
    mockedFetchConsent.mockResolvedValue(consentState());
    mockedPatchStatus.mockRejectedValue(new SanityRevisionConflictError());

    const first = await POST(request({action: "decline", remnantId: "remnant-1"}));
    const second = await POST(request({action: "decline", remnantId: "remnant-1"}));

    expect(first.status).toBe(409);
    expect(second.status).toBe(409);
    expect(mockedDecline).toHaveBeenNthCalledWith(1, expect.any(String), {
      idempotencyKey: "consent/tessom-dev/remnant-1:decline:default",
      idempotent: true,
    });
    expect(mockedDecline).toHaveBeenNthCalledWith(2, expect.any(String), {
      idempotencyKey: "consent/tessom-dev/remnant-1:decline:default",
      idempotent: true,
    });
  });

  it("sanitizes unexpected failures", async () => {
    mockedFetchOrder.mockRejectedValue(new Error("Sanity token secret and internal URL"));

    const response = await POST(request({action: "mark-cut", workflowInstanceId: "workflow.order-1"}));
    const body = await json(response);

    expect(response.status).toBe(500);
    expect(body).toEqual({error: "Unable to advance workflow"});
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
