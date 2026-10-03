import {beforeEach, describe, expect, it, vi} from "vitest";

import {POST} from "../../app/api/orders/route";
import {MAX_JSON_BODY_BYTES} from "../../lib/http/json-body";
import {fingerprintOffer} from "../../lib/orders";
import {computeOffers} from "../../lib/offers";
import {DEFAULT_OFFER_RATES} from "../../lib/offers/rates";
import {
  commitAllocatedOrder,
  fetchOrderReplay,
  fetchOrderContext,
  hasCommittedOrder,
  type CommittedOrderSummary,
} from "../../lib/sanity";
import {
  abandonPreparedLifecycleAllocation,
  allocateRemnant,
  finalizeLifecycleAllocation,
  prepareLifecycleAllocation,
  tickWorkflowInstance,
  UnusableLifecycleInstanceError,
  type PreparedLifecycleAllocation,
} from "../../lib/workflow";

vi.mock("../../lib/sanity", async () => {
  const actual = await vi.importActual<typeof import("../../lib/sanity")>("../../lib/sanity");
  return {
    ...actual,
    commitAllocatedOrder: vi.fn(),
    fetchOrderReplay: vi.fn(),
    fetchOrderContext: vi.fn(),
    hasCommittedOrder: vi.fn(),
  };
});

vi.mock("../../lib/workflow", async () => {
  const actual = await vi.importActual<typeof import("../../lib/workflow")>("../../lib/workflow");
  return {
    ...actual,
    abandonPreparedLifecycleAllocation: vi.fn(),
    allocateRemnant: vi.fn(),
    finalizeLifecycleAllocation: vi.fn(),
    prepareLifecycleAllocation: vi.fn(),
    tickWorkflowInstance: vi.fn(),
  };
});

const mockedCommitAllocatedOrder = vi.mocked(commitAllocatedOrder);
const mockedFetchOrderReplay = vi.mocked(fetchOrderReplay);
const mockedFetchOrderContext = vi.mocked(fetchOrderContext);
const mockedHasCommittedOrder = vi.mocked(hasCommittedOrder);
const mockedFinalizeLifecycleAllocation = vi.mocked(finalizeLifecycleAllocation);
const mockedPrepareLifecycleAllocation = vi.mocked(prepareLifecycleAllocation);
const mockedAbandonPreparedLifecycleAllocation = vi.mocked(abandonPreparedLifecycleAllocation);
const mockedAllocateRemnant = vi.mocked(allocateRemnant);
const mockedTickWorkflowInstance = vi.mocked(tickWorkflowInstance);

const context = {
  remnant: {
    _id: "remnant-1",
    _rev: "rev-1",
    title: "Private title",
    status: "listed",
    widthCm: 100,
    heightCm: 100,
    fabric: {name: "Wool", maker: "Maker", valuePerM: 100},
    directional: false,
    defects: [],
    allocations: [],
    ownerShareBps: 2_000,
  },
  templates: [
    {
      _id: "template-cushion",
      name: "Cushion",
      pieces: [{label: "front", wCm: 40, hCm: 40, centerPattern: false}],
      seamCm: 1,
      labourMin: 10,
      fillCost: 5,
      active: true,
    },
  ],
};

const prepared = {
  engine: {},
  instanceId: "tessom-tessom-dev-order-orders-test-order",
  started: {},
} as unknown as PreparedLifecycleAllocation;

function request(body: unknown, headers: Record<string, string> = {"content-type": "application/json"}) {
  return new Request("https://tessom.test/api/orders", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
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
  const init = {method: "POST", headers, body, duplex: "half"} as RequestInit;
  return {
    request: new Request("https://tessom.test/api/orders", init),
    pulls: () => pulls,
    cancelled: () => cancelled,
  };
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const orderRequest = {
  remnantId: "remnant-1",
  templateId: "template-cushion",
  buyerName: "Ada Lovelace",
  buyerEmail: "ada@example.com",
  idempotencyKey: "checkout-1",
};

function committedSummary(input: Parameters<typeof commitAllocatedOrder>[0]): CommittedOrderSummary {
  return {
    orderId: input.orderId,
    remnantId: input.remnantId,
    templateId: input.templateId,
    placement: [...input.placement],
    price: input.price,
    ownerShare: input.ownerShare,
    createdAt: "createdAt" in input ? input.createdAt : input.order.createdAt,
  };
}

describe("POST /api/orders", () => {
  beforeEach(() => {
    mockedFetchOrderContext.mockReset().mockResolvedValue(context);
    mockedFetchOrderReplay.mockReset().mockResolvedValue({status: "missing"});
    mockedHasCommittedOrder
      .mockReset()
      .mockRejectedValue(new Error("Missing required environment variable: SANITY_API_WRITE_TOKEN"));
    mockedCommitAllocatedOrder.mockReset().mockImplementation(async (input) => committedSummary(input));
    mockedPrepareLifecycleAllocation.mockReset().mockResolvedValue(prepared);
    mockedAbandonPreparedLifecycleAllocation.mockReset().mockResolvedValue({} as never);
    mockedAllocateRemnant.mockReset().mockResolvedValue({} as never);
    mockedTickWorkflowInstance.mockReset().mockResolvedValue({} as never);
    mockedFinalizeLifecycleAllocation.mockReset().mockImplementation(async (instance, commit) => {
      try {
        const value = await commit(instance);
        return {committed: true, prepared: instance, value, allocation: undefined, tick: undefined};
      } catch (error) {
        return {committed: false, prepared: instance, orphanedInstanceId: instance.instanceId, error};
      }
    });
  });

  it("wires fresh context, server rates, prepares before commit, and returns the real workflow ID", async () => {
    const events: string[] = [];
    mockedPrepareLifecycleAllocation.mockImplementationOnce(async (_remnantId, options) => {
      events.push("prepare");
      expect(options.orderId).toMatch(/^orders\./);
      return prepared;
    });
    mockedFinalizeLifecycleAllocation.mockImplementationOnce(async (instance, commit) => {
      events.push("finalize");
      const value = await commit(instance);
      events.push("committed");
      return {committed: true, prepared: instance, value, allocation: undefined, tick: undefined};
    });
    mockedCommitAllocatedOrder.mockImplementationOnce(async (input) => {
      events.push("commit");
      return committedSummary(input);
    });

    const response = await POST(request(orderRequest));
    const body = await json(response);
    const commitInput = mockedCommitAllocatedOrder.mock.calls[0]?.[0];

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(events).toEqual(["prepare", "finalize", "commit", "committed"]);
    expect(mockedFetchOrderContext).toHaveBeenCalledWith("remnant-1");
    expect(mockedCommitAllocatedOrder).toHaveBeenCalledOnce();
    expect(commitInput).toMatchObject({
      remnantId: "remnant-1",
      templateId: "template-cushion",
      ifRevisionId: "rev-1",
      idempotencyKey: "checkout-1",
      workflowInstanceId: prepared.instanceId,
    });
    expect(body).toMatchObject({
      orderId: commitInput?.orderId,
      workflowInstanceId: prepared.instanceId,
      remnantId: "remnant-1",
      templateId: "template-cushion",
    });
    expect(commitInput?.price).toBe(
      computeOffers(context.remnant, context.templates, DEFAULT_OFFER_RATES)[0]?.price,
    );
    expect(mockedPrepareLifecycleAllocation).toHaveBeenCalledOnce();
    expect(mockedPrepareLifecycleAllocation.mock.calls[0]?.[1]).not.toHaveProperty("returnToListed");
    expect(mockedFinalizeLifecycleAllocation).toHaveBeenCalledOnce();
  });

  it("keeps sold-out settlement out of lifecycle preparation", async () => {
    mockedFetchOrderContext.mockResolvedValueOnce({
      ...context,
      remnant: {...context.remnant, widthCm: 42, heightCm: 42},
    });

    const response = await POST(request(orderRequest));

    expect(response.status).toBe(200);
    expect(mockedPrepareLifecycleAllocation.mock.calls[0]?.[1]).not.toHaveProperty("returnToListed");
  });

  it("returns a keyed replay before loading context or preparing a workflow", async () => {
    mockedFetchOrderReplay.mockResolvedValueOnce({
      status: "matched",
      orderId: "orders.replayed",
      workflowInstanceId: "workflow/winner",
      remnantId: "remnant-1",
      templateId: "template-cushion",
      placement: [{x: 4, y: 5, w: 44, h: 44, rotated: false}],
      usedArea: 1936,
      price: 84.5,
      ownerShare: 18.25,
      createdAt: "2026-10-02T21:00:00.000Z",
    });

    const response = await POST(request(orderRequest));

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      orderId: "orders.replayed",
      workflowInstanceId: "workflow/winner",
      price: 84.5,
    });
    expect(mockedFetchOrderContext).not.toHaveBeenCalled();
    expect(mockedPrepareLifecycleAllocation).not.toHaveBeenCalled();
    expect(mockedCommitAllocatedOrder).not.toHaveBeenCalled();
    expect(mockedAllocateRemnant).toHaveBeenCalledWith(
      "workflow/winner",
      expect.objectContaining({idempotencyKey: "orders.replayed:allocation", idempotent: true}),
    );
    expect(mockedTickWorkflowInstance).toHaveBeenCalledWith(
      "workflow/winner",
      expect.objectContaining({idempotencyKey: "orders.replayed:allocation", idempotent: true}),
    );
  });

  it("returns allocation recovery metadata when a keyed replay is still pending", async () => {
    mockedFetchOrderReplay.mockResolvedValueOnce({
      status: "matched",
      orderId: "orders.replayed",
      workflowInstanceId: "workflow/pending",
      remnantId: "remnant-1",
      templateId: "template-cushion",
      placement: [{x: 4, y: 5, w: 44, h: 44, rotated: false}],
      usedArea: 1936,
      price: 84.5,
      ownerShare: 18.25,
      createdAt: "2026-10-02T21:00:00.000Z",
    });
    mockedAllocateRemnant.mockRejectedValueOnce(new Error("allocation is still pending"));

    const response = await POST(request(orderRequest));
    const body = await json(response);

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: "The order was saved but workflow activation is pending",
      orderId: "orders.replayed",
      workflowInstanceId: "workflow/pending",
      recoveryRequired: true,
      recoveryAction: "allocate",
    });
    expect(mockedTickWorkflowInstance).not.toHaveBeenCalled();
  });

  it("uses idempotent allocation and tick recovery for an already-complete replay", async () => {
    mockedFetchOrderReplay.mockResolvedValueOnce({
      status: "matched",
      orderId: "orders.complete",
      workflowInstanceId: "workflow/complete",
      remnantId: "remnant-1",
      templateId: "template-cushion",
      placement: [{x: 4, y: 5, w: 44, h: 44, rotated: false}],
      usedArea: 1936,
      price: 84.5,
      ownerShare: 18.25,
      createdAt: "2026-10-02T21:00:00.000Z",
    });

    const response = await POST(request(orderRequest));

    expect(response.status).toBe(200);
    expect(mockedAllocateRemnant).toHaveBeenCalledWith(
      "workflow/complete",
      expect.objectContaining({idempotent: true}),
    );
    expect(mockedTickWorkflowInstance).toHaveBeenCalledWith(
      "workflow/complete",
      expect.objectContaining({idempotent: true}),
    );
  });

  it("replays a keyed order on a sequential retry", async () => {
    mockedFetchOrderReplay
      .mockResolvedValueOnce({status: "missing"})
      .mockResolvedValueOnce({
        status: "matched",
        orderId: "orders.sequential",
        workflowInstanceId: "workflow/sequential",
        remnantId: "remnant-1",
        templateId: "template-cushion",
        placement: [{x: 4, y: 5, w: 44, h: 44, rotated: false}],
        usedArea: 1936,
        price: 84.5,
        ownerShare: 18.25,
        createdAt: "2026-10-02T21:00:00.000Z",
      });

    const first = await POST(request(orderRequest));
    const second = await POST(request(orderRequest));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await json(second)).orderId).toBe("orders.sequential");
    expect(mockedPrepareLifecycleAllocation).toHaveBeenCalledOnce();
    expect(mockedCommitAllocatedOrder).toHaveBeenCalledOnce();
  });

  it("maps a keyed replay fingerprint mismatch to 409", async () => {
    mockedFetchOrderReplay.mockResolvedValueOnce({status: "mismatch"});

    const response = await POST(request({...orderRequest, buyerEmail: "other@example.com"}));

    expect(response.status).toBe(409);
    expect(mockedFetchOrderContext).not.toHaveBeenCalled();
    expect(mockedPrepareLifecycleAllocation).not.toHaveBeenCalled();
  });

  it.each([
    "Missing required environment variable: ORDER_ENCRYPTION_KEY",
    "Server configuration is unavailable: Invalid ORDER_ENCRYPTION_KEY configuration",
    "Missing required environment variable: NEXT_PUBLIC_SANITY_PROJECT_ID",
  ])("maps keyed replay configuration failure to 503 before workflow preparation: %s", async (message) => {
    mockedFetchOrderReplay.mockRejectedValueOnce(new Error(message));

    const response = await POST(request(orderRequest));

    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({error: "Order service is unavailable"});
    expect(mockedFetchOrderContext).not.toHaveBeenCalled();
    expect(mockedPrepareLifecycleAllocation).not.toHaveBeenCalled();
    expect(mockedCommitAllocatedOrder).not.toHaveBeenCalled();
  });

  it("reconciles a concurrent loser onto the persisted winner workflow", async () => {
    mockedPrepareLifecycleAllocation.mockImplementation(async (_remnantId, options) => ({
      ...prepared,
      instanceId: options.instanceId as string,
    }));
    mockedCommitAllocatedOrder
      .mockImplementationOnce(async (input) => committedSummary(input))
      .mockRejectedValueOnce({statusCode: 409, message: "revision mismatch"});
    mockedHasCommittedOrder.mockResolvedValueOnce(true);
    const winnerWorkflow = "workflow/winner";
    mockedFetchOrderReplay
      .mockResolvedValueOnce({status: "missing"})
      .mockResolvedValueOnce({status: "missing"})
      .mockResolvedValueOnce({
        status: "matched",
        orderId: "orders.replayed",
        workflowInstanceId: winnerWorkflow,
        remnantId: "remnant-1",
        templateId: "template-cushion",
        placement: [{x: 4, y: 5, w: 44, h: 44, rotated: false}],
        usedArea: 1936,
        price: 84.5,
        ownerShare: 18.25,
        createdAt: "2026-10-02T21:00:00.000Z",
      });

    const [first, second] = await Promise.all([
      POST(request(orderRequest)),
      POST(request(orderRequest)),
    ]);
    const preparedWorkflowIds = mockedPrepareLifecycleAllocation.mock.calls.map((call) => call[1].instanceId);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(new Set(preparedWorkflowIds).size).toBe(2);
    expect(mockedAbandonPreparedLifecycleAllocation).toHaveBeenCalledOnce();
    const winnerInput = mockedCommitAllocatedOrder.mock.calls[0]?.[0] as unknown as {
      workflowInstanceId?: string;
      order?: {workflowInstanceId?: string};
    };
    const winnerAttempt = winnerInput.workflowInstanceId ?? winnerInput.order?.workflowInstanceId;
    expect(mockedAbandonPreparedLifecycleAllocation.mock.calls[0]?.[0].instanceId).not.toBe(winnerAttempt);
    expect(mockedAllocateRemnant).toHaveBeenCalledWith(winnerWorkflow, expect.objectContaining({idempotent: true}));
    expect(mockedTickWorkflowInstance).toHaveBeenCalledWith(winnerWorkflow, expect.objectContaining({idempotent: true}));
  });

  it("recovers an ambiguous committed write with the persisted workflow", async () => {
    mockedCommitAllocatedOrder.mockRejectedValueOnce(new Error("transaction unavailable"));
    mockedHasCommittedOrder.mockResolvedValueOnce(true);
    mockedFetchOrderReplay.mockResolvedValueOnce({status: "missing"}).mockResolvedValueOnce({
      status: "matched",
      orderId: "orders.replayed",
      workflowInstanceId: "workflow/persisted",
      remnantId: "remnant-1",
      templateId: "template-cushion",
      placement: [{x: 4, y: 5, w: 44, h: 44, rotated: false}],
      usedArea: 1936,
      price: 84.5,
      ownerShare: 18.25,
      createdAt: "2026-10-02T21:00:00.000Z",
    });

    const response = await POST(request(orderRequest));

    expect(response.status).toBe(200);
    expect((await json(response)).workflowInstanceId).toBe("workflow/persisted");
    expect(mockedAllocateRemnant).toHaveBeenCalledWith("workflow/persisted", expect.objectContaining({idempotent: true}));
    expect(mockedTickWorkflowInstance).toHaveBeenCalledWith("workflow/persisted", expect.objectContaining({idempotent: true}));
    expect(mockedAbandonPreparedLifecycleAllocation).toHaveBeenCalledOnce();
  });

  it("abandons the prepared guard after an ambiguous write is confirmed absent", async () => {
    mockedCommitAllocatedOrder.mockRejectedValueOnce(new Error("transaction unavailable"));
    mockedHasCommittedOrder.mockResolvedValueOnce(false);

    const response = await POST(request(orderRequest));

    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({error: "Unable to confirm order commit", retryable: true});
    expect(mockedAbandonPreparedLifecycleAllocation).toHaveBeenCalledOnce();
    expect(mockedAllocateRemnant).not.toHaveBeenCalled();
  });

  it("returns safe recovery metadata when commit reconciliation lookup fails", async () => {
    mockedCommitAllocatedOrder.mockRejectedValueOnce(new Error("transaction unavailable"));
    mockedHasCommittedOrder.mockRejectedValueOnce(new Error("secret internal URL"));

    const response = await POST(request(orderRequest));
    const body = await json(response);

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      error: "The order commit could not be reconciled",
      orderId: expect.stringMatching(/^orders\./),
      workflowInstanceId: prepared.instanceId,
      recoveryRequired: true,
      recoveryAction: "reconcile",
    });
    expect(JSON.stringify(body)).not.toContain("secret internal URL");
    expect(mockedAbandonPreparedLifecycleAllocation).not.toHaveBeenCalled();
  });

  it("maps a repeat allocation conflict to 409", async () => {
    mockedCommitAllocatedOrder.mockRejectedValueOnce({statusCode: 409, message: "revision mismatch"});

    const response = await POST(request(orderRequest));

    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({error: "The remnant changed while the order was being placed"});
    expect(mockedAbandonPreparedLifecycleAllocation).toHaveBeenCalledWith(
      prepared,
      expect.objectContaining({idempotent: true}),
    );
  });

  it("abandons a prepared workflow before returning a confirmed conflict", async () => {
    const events: string[] = [];
    mockedPrepareLifecycleAllocation.mockImplementationOnce(async () => {
      events.push("prepare");
      return prepared;
    });
    mockedCommitAllocatedOrder.mockImplementationOnce(async () => {
      events.push("commit");
      throw {statusCode: 409, message: "revision mismatch"};
    });
    mockedAbandonPreparedLifecycleAllocation.mockImplementationOnce(async () => {
      events.push("abandon");
      return {} as never;
    });

    const response = await POST(request(orderRequest));

    expect(response.status).toBe(409);
    expect(events).toEqual(["prepare", "commit", "abandon"]);
  });

  it("returns safe reconciliation metadata when conflict cleanup fails", async () => {
    mockedCommitAllocatedOrder.mockRejectedValueOnce({statusCode: 409, message: "revision mismatch"});
    mockedAbandonPreparedLifecycleAllocation.mockRejectedValueOnce(new Error("workflow secret and internal URL"));

    const response = await POST(request(orderRequest));
    const body = await json(response);

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      error: "The order workflow could not be reconciled",
      orderId: expect.stringMatching(/^orders\./),
      workflowInstanceId: prepared.instanceId,
      recoveryRequired: true,
      recoveryAction: "abandon",
    });
    expect(JSON.stringify(body)).not.toContain("workflow secret");
    expect(body).not.toHaveProperty("retryable");
  });

  it("does not abandon a prepared workflow for an ambiguous commit failure", async () => {
    mockedCommitAllocatedOrder.mockRejectedValueOnce(new Error("transaction unavailable"));

    const response = await POST(request(orderRequest));

    expect(response.status).toBe(500);
    expect(mockedAbandonPreparedLifecycleAllocation).not.toHaveBeenCalled();
  });

  it("maps a stale fingerprint to 409 before workflow preparation", async () => {
    const offer = computeOffers(context.remnant, context.templates, DEFAULT_OFFER_RATES)[0];
    const response = await POST(request({...orderRequest, offerFingerprint: fingerprintOffer(offer).slice(0, -1)}));

    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({error: "That offer has changed and must be selected again"});
    expect(mockedPrepareLifecycleAllocation).not.toHaveBeenCalled();
    expect(mockedCommitAllocatedOrder).not.toHaveBeenCalled();
  });

  it("returns 503 for preparation failure without committing an order", async () => {
    mockedPrepareLifecycleAllocation.mockRejectedValueOnce(new Error("workflow unavailable"));

    const response = await POST(request(orderRequest));
    const body = await json(response);

    expect(response.status).toBe(503);
    expect(body).toEqual({error: "The order workflow could not be prepared", retryable: true});
    expect(mockedCommitAllocatedOrder).not.toHaveBeenCalled();
  });

  it("maps an unusable prepared instance to abandon recovery", async () => {
    mockedPrepareLifecycleAllocation.mockRejectedValueOnce(
      new UnusableLifecycleInstanceError("workflow/unusable"),
    );

    const response = await POST(request(orderRequest));
    const body = await json(response);

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: "The order workflow could not be reconciled",
      orderId: expect.stringMatching(/^orders\./),
      workflowInstanceId: "workflow/unusable",
      recoveryRequired: true,
      recoveryAction: "abandon",
    });
    expect(mockedCommitAllocatedOrder).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON and invalid body policy with 400", async () => {
    const malformed = await POST(request("{", {"content-type": "application/json"}));
    const wrongType = await POST(request(orderRequest, {"content-type": "text/plain"}));

    expect(malformed.status).toBe(400);
    expect(wrongType.status).toBe(400);
    expect(await json(malformed)).toEqual({error: "Invalid order request"});
    expect(await json(wrongType)).toEqual({error: "Invalid order request"});
    expect(mockedFetchOrderContext).not.toHaveBeenCalled();
  });

  it("rejects malformed Sanity IDs before loading order context", async () => {
    for (const field of ["remnantId", "templateId"] as const) {
      for (const value of ["bad id", "bad..id"]) {
        const response = await POST(request({...orderRequest, [field]: value}));
        expect(response.status).toBe(400);
        expect(await json(response)).toEqual({error: "Invalid order request"});
      }
    }
    expect(mockedFetchOrderContext).not.toHaveBeenCalled();
  });

  it("stops reading a streamed body at the byte limit without Content-Length", async () => {
    const tracked = streamingRequest({"content-type": "application/json"});

    const response = await POST(tracked.request);

    expect(response.status).toBe(400);
    expect(tracked.cancelled()).toBe(true);
    expect(tracked.pulls()).toBeLessThan(20);
    expect(mockedFetchOrderContext).not.toHaveBeenCalled();
  });

  it("enforces the stream limit when Content-Length is dishonest", async () => {
    const tracked = streamingRequest({"content-type": "application/json", "content-length": "1"});

    const response = await POST(tracked.request);

    expect(response.status).toBe(400);
    expect(tracked.cancelled()).toBe(true);
    expect(tracked.pulls()).toBeLessThan(20);
    expect(mockedFetchOrderContext).not.toHaveBeenCalled();
  });

  it("sanitizes missing server configuration as a 503", async () => {
    mockedFetchOrderContext.mockRejectedValueOnce(
      new Error("Missing required environment variable: SANITY_API_WRITE_TOKEN super-secret"),
    );

    const response = await POST(request(orderRequest));
    const body = await json(response);

    expect(response.status).toBe(503);
    expect(body).toEqual({error: "Order service is unavailable"});
    expect(JSON.stringify(body)).not.toContain("super-secret");
  });

  it("sanitizes unknown failures as a 500", async () => {
    mockedFetchOrderContext.mockRejectedValueOnce(new Error("internal URL and secret token"));

    const response = await POST(request(orderRequest));
    const body = await json(response);

    expect(response.status).toBe(500);
    expect(body).toEqual({error: "Unable to place order"});
    expect(JSON.stringify(body)).not.toContain("secret token");
  });

  it("returns only safe retry metadata when finalization fails after commit", async () => {
    mockedFinalizeLifecycleAllocation.mockImplementationOnce(async (instance, commit) => {
      await commit(instance);
      throw new Error("workflow secret and internal URL");
    });

    const response = await POST(request(orderRequest));
    const body = await json(response);

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      orderId: expect.stringMatching(/^orders\./),
      workflowInstanceId: prepared.instanceId,
      recoveryRequired: true,
      recoveryAction: "allocate",
    });
    expect(Object.keys(body).sort()).toEqual([
      "error",
      "orderId",
      "recoveryAction",
      "recoveryRequired",
      "workflowInstanceId",
    ]);
    expect(body).not.toHaveProperty("retryable");
    expect(JSON.stringify(body)).not.toContain("workflow secret");
    expect(mockedCommitAllocatedOrder).toHaveBeenCalledOnce();
  });
});
