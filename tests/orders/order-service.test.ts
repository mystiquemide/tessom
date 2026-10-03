import { describe, expect, it, vi } from "vitest";

import {
  BadOrderRequestError,
  OrderConflictError,
  UnavailableOfferError,
  WorkflowAllocationError,
  WorkflowPreparationError,
  createOrder,
  fingerprintOffer,
  type OrderContext,
  type OrderRemnant,
  type OrderServiceDependencies,
} from "../../lib/orders";
import { computeOffers, type ProductTemplate } from "../../lib/offers";

const request = {
  remnantId: "remnant-1",
  templateId: "cushion",
  buyerName: "Ada Lovelace",
  buyerEmail: "ada@example.com",
};

const remnant = (overrides: Partial<OrderRemnant> = {}): OrderRemnant => ({
  _id: "remnant-1",
  _rev: "rev-1",
  status: "listed",
  widthCm: 100,
  heightCm: 100,
  fabric: {name: "Test cloth", valuePerM: 100},
  directional: false,
  owner: {shareBps: 2_000},
  ...overrides,
});

const template = (overrides: Partial<ProductTemplate> = {}): ProductTemplate => ({
  id: "cushion",
  name: "Cushion",
  pieces: [{label: "front", wCm: 40, hCm: 40}],
  seamCm: 0,
  labourMin: 10,
  fillCost: 5,
  active: true,
  ...overrides,
});

const context = (overrides: Partial<OrderContext> = {}): OrderContext => ({
  remnant: remnant(),
  templates: [template()],
  ...overrides,
});

const dependencies = (
  current: OrderContext = context(),
  overrides: Partial<OrderServiceDependencies> = {},
): OrderServiceDependencies => ({
  loadOrderContext: vi.fn(async () => current),
  commitOrder: vi.fn(async () => undefined),
  prepareWorkflow: vi.fn(async () => ({workflowInstanceId: "workflow/test-instance"})),
  allocate: vi.fn(async () => undefined),
  rates: {labourRate: 2, marginMultiplier: 1.5},
  createOrderId: () => "orders/test-order",
  now: () => "2026-10-02T12:00:00.000Z",
  ...overrides,
});

describe("createOrder", () => {
  it("loads a fresh context and recomputes placement and price from server rates", async () => {
    const deps = dependencies();

    const result = await createOrder(request, deps);
    const commit = deps.commitOrder as ReturnType<typeof vi.fn>;
    const input = commit.mock.calls[0][0];

    expect((deps.loadOrderContext as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(result.placement).toEqual(input.placement);
    expect(input.expectedRevision).toBe("rev-1");
    expect(input.ifRevisionId).toBe("rev-1");
    expect(input.price).toBe(49.5);
    expect(input.ownerShare).toBe(1.6);
    expect(input.order.price).toBe(input.price);
    expect(input.order.ownerShare).toBe(input.ownerShare);
    expect(input.order.buyerEmail).toBe("ada@example.com");
  });

  it("returns a keyed replay before loading context or preparing a workflow", async () => {
    const replay = {
      status: "matched" as const,
      orderId: "orders.replayed",
      workflowInstanceId: "workflow/replayed",
      remnantId: "remnant-1",
      templateId: "cushion",
      placement: [{x: 2, y: 3, w: 40, h: 40, rotated: false}],
      usedArea: 1600,
      price: 99,
      ownerShare: 20,
      createdAt: "2026-10-02T12:00:00.000Z",
    };
    const loadOrderContext = vi.fn(async () => context());
    const prepareWorkflow = vi.fn(async () => ({workflowInstanceId: "workflow/new"}));
    const commitOrder = vi.fn(async () => undefined);
    const recoverReplay = vi.fn(async () => undefined);
    const deps = dependencies(context(), {
      loadOrderContext,
      loadOrderReplay: vi.fn(async () => replay),
      recoverReplay,
      prepareWorkflow,
      commitOrder,
      allocate: vi.fn(async () => undefined),
    });

    await expect(createOrder({...request, idempotencyKey: "checkout-1"}, deps)).resolves.toMatchObject({
      orderId: replay.orderId,
      workflowInstanceId: replay.workflowInstanceId,
      remnantId: replay.remnantId,
      templateId: replay.templateId,
      placement: replay.placement,
      usedArea: replay.usedArea,
      price: replay.price,
      ownerShare: replay.ownerShare,
      createdAt: replay.createdAt,
    });
    expect(loadOrderContext).not.toHaveBeenCalled();
    expect(prepareWorkflow).not.toHaveBeenCalled();
    expect(commitOrder).not.toHaveBeenCalled();
    expect(recoverReplay).toHaveBeenCalledWith({
      orderId: replay.orderId,
      workflowInstanceId: replay.workflowInstanceId,
    });
  });

  it("maps keyed replay recovery failure to allocation recovery metadata", async () => {
    const recoverReplay = vi.fn(async () => {
      throw new Error("workflow service unavailable");
    });
    const deps = dependencies(context(), {
      loadOrderReplay: vi.fn(async () => ({
        status: "matched" as const,
        orderId: "orders.replayed",
        workflowInstanceId: "workflow/replayed",
        remnantId: "remnant-1",
        templateId: "cushion",
        placement: [{x: 2, y: 3, w: 40, h: 40, rotated: false}],
        usedArea: 1600,
        price: 99,
        ownerShare: 20,
        createdAt: "2026-10-02T12:00:00.000Z",
      })),
      recoverReplay,
    });

    const error = await createOrder({...request, idempotencyKey: "checkout-1"}, deps).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(WorkflowAllocationError);
    expect(error).toMatchObject({
      orderId: "orders.replayed",
      workflowInstanceId: "workflow/replayed",
      recoveryRequired: true,
      recoveryAction: "allocate",
    });
  });

  it("rejects a keyed replay whose protected request identity does not match", async () => {
    const loadOrderReplay = vi.fn(async () => ({status: "mismatch" as const}));
    const deps = dependencies(context(), {loadOrderReplay});

    await expect(createOrder({...request, idempotencyKey: "checkout-1"}, deps)).rejects.toMatchObject({
      code: "CONFLICT",
      httpStatus: 409,
    });
    expect(deps.prepareWorkflow).not.toHaveBeenCalled();
    expect(deps.commitOrder).not.toHaveBeenCalled();
  });

  it("gives concurrent keyed attempts distinct secure workflow instance inputs", async () => {
    const prepareWorkflow = vi.fn(async (input) => ({workflowInstanceId: input.workflowInstanceId}));
    const deps = dependencies(context(), {prepareWorkflow});

    await Promise.all([
      createOrder({...request, idempotencyKey: "checkout-1"}, deps),
      createOrder({...request, idempotencyKey: "checkout-1"}, deps),
    ]);

    const instanceIds = prepareWorkflow.mock.calls.map(([input]) => input.workflowInstanceId);
    expect(new Set(instanceIds).size).toBe(2);
    expect(instanceIds.every((value) => /^tessom-order-attempt-[0-9a-f-]{36}$/.test(value))).toBe(true);
  });

  it("prepares a lifecycle without deciding the post-shipping remnant state", async () => {
    const deps = dependencies();

    await createOrder(request, deps);

    const prepare = deps.prepareWorkflow as ReturnType<typeof vi.fn>;
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0]?.[0]).not.toHaveProperty("returnToListed");
  });

  it("keeps post-shipping state out of preparation even when the selected offer fills the remnant", async () => {
    const deps = dependencies(
      context({
        remnant: remnant({widthCm: 40, heightCm: 40}),
      }),
    );

    await createOrder(request, deps);

    const prepare = deps.prepareWorkflow as ReturnType<typeof vi.fn>;
    expect(prepare.mock.calls[0]?.[0]).not.toHaveProperty("returnToListed");
  });

  it("accepts an allocated remnant when a fresh free area remains", async () => {
    const deps = dependencies(
      context({
        remnant: remnant({
          status: "allocated",
          allocations: [{x: 0, y: 0, w: 60, h: 100}],
        }),
      }),
    );

    const result = await createOrder(request, deps);

    expect(result.placement[0]).toMatchObject({x: 60, y: 0, w: 40, h: 40});
  });

  it("rejects geometry and price fields from the request", async () => {
    const deps = dependencies();

    await expect(
      createOrder(
        {...request, placement: [{x: 99, y: 99, w: 1, h: 1}], price: 0},
        deps,
      ),
    ).rejects.toBeInstanceOf(BadOrderRequestError);
    expect(deps.loadOrderContext).not.toHaveBeenCalled();
  });

  it("rejects an inactive template and an unlisted remnant", async () => {
    const inactive = dependencies(context({templates: [template({active: false})]}));
    await expect(createOrder(request, inactive)).rejects.toMatchObject({
      code: "UNAVAILABLE_OFFER",
      reason: "TEMPLATE_UNAVAILABLE",
    });

    const unlisted = dependencies(context({remnant: remnant({status: "consented"})}));
    await expect(createOrder(request, unlisted)).rejects.toMatchObject({
      code: "UNAVAILABLE_OFFER",
      reason: "REMNANT_NOT_LISTED",
    });
  });

  it("rejects a stale server-issued offer fingerprint", async () => {
    const staleOffer = computeOffers(remnant(), [template()], {
      labourRate: 1,
      marginMultiplier: 1,
    })[0];
    const deps = dependencies();

    await expect(
      createOrder({...request, offerFingerprint: fingerprintOffer(staleOffer)}, deps),
    ).rejects.toMatchObject({code: "UNAVAILABLE_OFFER", reason: "STALE_OFFER"});
    expect(deps.commitOrder).not.toHaveBeenCalled();
  });

  it("uses server rates even when the caller tries to provide a rate", async () => {
    const deps = dependencies();

    await expect(createOrder({...request, rates: {labourRate: 0}}, deps)).rejects.toBeInstanceOf(
      BadOrderRequestError,
    );
    expect(deps.commitOrder).not.toHaveBeenCalled();
  });

  it("propagates an optimistic duplicate conflict and never starts workflow", async () => {
    const allocate = vi.fn(async () => undefined);
    const deps = dependencies(context(), {
      commitOrder: vi.fn(async () => false as const),
      allocate,
    });

    await expect(createOrder(request, deps)).rejects.toBeInstanceOf(OrderConflictError);
    expect(allocate).not.toHaveBeenCalled();
  });

  it("calls workflow allocation only after persistence commits", async () => {
    const events: string[] = [];
    const deps = dependencies(context(), {
      prepareWorkflow: vi.fn(async () => {
        events.push("prepare");
        return {workflowInstanceId: "workflow/1"};
      }),
      commitOrder: vi.fn(async () => {
        events.push("commit");
        return {committed: true};
      }),
      allocate: vi.fn(async () => {
        events.push("allocate");
      }),
    });

    await createOrder(request, deps);

    expect(events).toEqual(["prepare", "commit", "allocate"]);
    expect((deps.commitOrder as ReturnType<typeof vi.fn>).mock.calls[0][0].order.workflowInstanceId).toBe(
      "workflow/1",
    );
    expect((deps.allocate as ReturnType<typeof vi.fn>).mock.calls[0][0].workflowInstanceId).toBe("workflow/1");
  });

  it("maps preparation failure before persistence and finalization", async () => {
    const commit = vi.fn(async () => undefined);
    const allocate = vi.fn(async () => undefined);
    const deps = dependencies(context(), {
      prepareWorkflow: vi.fn(async () => {
        throw new Error("workflow unavailable");
      }),
      commitOrder: commit,
      allocate,
    });

    const error = await createOrder(request, deps).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(WorkflowPreparationError);
    expect(error).toMatchObject({code: "WORKFLOW_FAILURE", phase: "prepare", committed: false});
    expect(commit).not.toHaveBeenCalled();
    expect(allocate).not.toHaveBeenCalled();
  });

  it("reports a committed order when workflow allocation fails so the action can be retried", async () => {
    const commit = vi.fn(async () => undefined);
    const allocate = vi.fn(async () => {
      throw new Error("workflow unavailable");
    });
    const deps = dependencies(context(), {commitOrder: commit, allocate});

    const error = await createOrder(request, deps).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(WorkflowAllocationError);
    expect(error).toMatchObject({
      code: "WORKFLOW_FAILURE",
      phase: "finalize",
      orderId: "orders/test-order",
      workflowInstanceId: "workflow/test-instance",
      committed: true,
      recoveryRequired: true,
      recoveryAction: "allocate",
    });
    expect(commit).toHaveBeenCalledOnce();
    expect(allocate).toHaveBeenCalledWith(expect.objectContaining({orderId: "orders/test-order"}));
  });

  it("keeps the default order ID stable only for the same explicit idempotency key", async () => {
    const first = dependencies(context(), {createOrderId: undefined});
    const second = dependencies(context(), {createOrderId: undefined});
    const withKey = {...request, idempotencyKey: "checkout-1"};

    const firstResult = await createOrder(withKey, first);
    const secondResult = await createOrder(withKey, second);

    expect(secondResult.orderId).toBe(firstResult.orderId);

    const withoutKeyFirst = await createOrder(request, dependencies(context(), {createOrderId: undefined}));
    const withoutKeySecond = await createOrder(request, dependencies(context(), {createOrderId: undefined}));
    expect(withoutKeySecond.orderId).not.toBe(withoutKeyFirst.orderId);
    expect(withoutKeyFirst.orderId).toMatch(/^orders\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("does not include mutable buyer or template fields in a keyed order ID", async () => {
    const first = await createOrder(
      {...request, idempotencyKey: "checkout-identity"},
      dependencies(context(), {createOrderId: undefined}),
    );
    const second = await createOrder(
      {...request, buyerName: "Grace Hopper", buyerEmail: "grace@example.com", idempotencyKey: "checkout-identity"},
      dependencies(context(), {createOrderId: undefined}),
    );

    expect(second.orderId).toBe(first.orderId);
  });

  it("surfaces the prepared instance when optimistic persistence conflicts", async () => {
    const allocate = vi.fn(async () => undefined);
    const deps = dependencies(context(), {
      prepareWorkflow: vi.fn(async () => ({workflowInstanceId: "workflow/orphan-1"})),
      commitOrder: vi.fn(async () => false as const),
      allocate,
    });

    const error = await createOrder(request, deps).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(OrderConflictError);
    expect(error).toMatchObject({
      code: "CONFLICT",
      orderId: "orders/test-order",
      orphanWorkflowInstanceId: "workflow/orphan-1",
    });
    expect(allocate).not.toHaveBeenCalled();
  });

  it("maps a missing remnant to an unavailable offer", async () => {
    const deps = dependencies(context(), {loadOrderContext: vi.fn(async () => null)});

    await expect(createOrder(request, deps)).rejects.toBeInstanceOf(UnavailableOfferError);
  });
});
