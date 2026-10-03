import {beforeEach, describe, expect, it, vi} from "vitest";

import {
  ORDER_CONTEXT_QUERY,
  SanityDataValidationError,
  SanityRevisionConflictError,
  commitAllocatedOrder,
  createSanityServerClient,
  decryptBuyerContact,
  fetchOrderContext,
  fetchOrderReplay,
  hasCommittedOrder,
  isSanityRevisionConflict,
  type OrderReplayInput,
  type SanityDocumentReadClient,
  type SanityPersistenceClient,
  type SanityTransaction,
} from "../../lib/sanity";
import type {OrderCommitInput} from "../../lib/orders";

const acceptsOrderCommand: (input: OrderCommitInput, client?: SanityPersistenceClient) => Promise<unknown> =
  commitAllocatedOrder;
void acceptsOrderCommand;

const contextResult = {
  remnant: {
    _id: "remnant-1",
    _rev: "rev-1",
    title: "Blue remnant",
    fabric: {name: "Blue linen", maker: "Mill", valuePerM: 120},
    widthCm: 140,
    heightCm: 90,
    repeat: {vCm: 20, hCm: 30},
    directional: false,
    defects: [{x: 10, y: 10, w: 4, h: 4}],
    allocations: [{x: 90, y: 0, w: 40, h: 40}],
    ownerShareBps: 2_000,
    status: "listed",
  },
  templates: [
    {
      _id: "template-cushion",
      name: "Cushion",
      kind: "cushion",
      pieces: [{label: "front", wCm: 40, hCm: 40, qty: 1, centerPattern: false}],
      seamCm: 2,
      labourMin: 30,
      fillCost: 12,
      active: true,
    },
  ],
};

class FakeTransaction implements SanityTransaction {
  readonly operations: Array<Record<string, unknown>> = [];
  commitError: unknown;

  create(document: Record<string, unknown>): this {
    this.operations.push({create: document});
    return this;
  }

  createIfNotExists(document: Record<string, unknown>): this {
    this.operations.push({createIfNotExists: document});
    return this;
  }

  patch(documentId: string, patch: Record<string, unknown>): this {
    this.operations.push({patch: {id: documentId, ...patch}});
    return this;
  }

  async commit(): Promise<unknown> {
    if (this.commitError !== undefined) throw this.commitError;
    return {transactionId: "transaction-1"};
  }
}

function fakeClient(transaction = new FakeTransaction()): SanityPersistenceClient & {transactionValue: FakeTransaction} {
  return {
    transaction: () => transaction,
    transactionValue: transaction,
    fetch: async <Result>() => contextResult as Result,
  };
}

const orderInput = {
  orderId: "orders.order-1",
  remnantId: "remnant-1",
  ifRevisionId: "rev-1",
  templateId: "template-cushion",
  placement: [
    {x: 4, y: 5, w: 44, h: 44, rotated: false},
    {x: 60, y: 5, w: 20, h: 30, rotated: true},
  ],
  price: 84.5,
  ownerShare: 18.25,
  buyerName: "A Buyer",
  buyerEmail: "buyer@example.com",
  workflowInstanceId: "workflow-order-1",
  createdAt: "2026-10-02T21:00:00.000Z",
} as const;

describe("Sanity server client", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
    delete process.env.NEXT_PUBLIC_SANITY_DATASET;
    delete process.env.SANITY_API_WRITE_TOKEN;
    process.env.ORDER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("requires all server configuration without echoing secret values", () => {
    expect(() => createSanityServerClient()).toThrow("NEXT_PUBLIC_SANITY_PROJECT_ID");

    process.env.NEXT_PUBLIC_SANITY_PROJECT_ID = "project-1";
    process.env.NEXT_PUBLIC_SANITY_DATASET = "production";
    expect(() => createSanityServerClient()).toThrow("SANITY_API_WRITE_TOKEN");
    expect(() => createSanityServerClient()).not.toThrow("super-secret");
  });

  it("uses the fixed API version and disables CDN reads", () => {
    const client = createSanityServerClient({
      NEXT_PUBLIC_SANITY_PROJECT_ID: "project-1",
      NEXT_PUBLIC_SANITY_DATASET: "production",
      SANITY_API_WRITE_TOKEN: "super-secret",
    });
    const config = client.config();
    expect(config).toMatchObject({
      projectId: "project-1",
      dataset: "production",
      apiVersion: "2026-10-01",
      useCdn: false,
    });
  });
});

describe("fetchOrderContext", () => {
  it("passes the remnant ID as a GROQ parameter and maps compatible offer types", async () => {
    const calls: Array<{query: string; params: Record<string, unknown> | undefined}> = [];
    const client: SanityPersistenceClient = {
      fetch: async <Result>(query: string, params?: Record<string, unknown>) => {
        calls.push({query, params});
        return contextResult as Result;
      },
      transaction: () => new FakeTransaction(),
    };

    const context = await fetchOrderContext("remnant-1", client);

    expect(calls).toHaveLength(1);
    expect(calls[0].query).toBe(ORDER_CONTEXT_QUERY);
    expect(calls[0].query).toContain("$remnantId");
    expect(calls[0].query).toContain('_type == "productTemplate" && active == true');
    expect(calls[0].params).toEqual({remnantId: "remnant-1"});
    expect(context?.remnant).toMatchObject({
      _id: "remnant-1",
      _rev: "rev-1",
      widthCm: 140,
      heightCm: 90,
      allocations: [{x: 90, y: 0, w: 40, h: 40}],
      ownerShareBps: 2_000,
    });
    expect(context?.templates[0]).toMatchObject({
      _id: "template-cushion",
      pieces: [{label: "front", wCm: 40, hCm: 40}],
      active: true,
    });
  });

  it("returns null when the remnant projection is missing", async () => {
    const client: SanityPersistenceClient = {
      fetch: async <Result>() => ({remnant: null, templates: []}) as Result,
      transaction: () => new FakeTransaction(),
    };
    await expect(fetchOrderContext("remnant-1", client)).resolves.toBeNull();
  });
});

describe("commitAllocatedOrder", () => {
  it("creates the stable order and locks all placements in one revision guarded transaction", async () => {
    const client = fakeClient();
    const result = await commitAllocatedOrder(orderInput, client);
    const [stateCreateOperation, statePatchOperation, createOperation, patchOperation] = client.transactionValue.operations;
    const created = createOperation.create as Record<string, unknown>;
    const patch = patchOperation.patch as Record<string, unknown>;
    const allocations = (patch.insert as {items: Record<string, unknown>[]}).items;

    expect(result).toMatchObject({orderId: "orders.order-1", remnantId: "remnant-1", templateId: "template-cushion"});
    expect(client.transactionValue.operations).toHaveLength(4);
    expect(stateCreateOperation.createIfNotExists).toMatchObject({
      _id: "tessom-commerce-state",
      _type: "commerceState",
      liveCommerce: true,
    });
    expect(statePatchOperation.patch).toMatchObject({
      id: "tessom-commerce-state",
      set: {liveCommerce: true},
    });
    expect(created).toMatchObject({
      _id: "orders.order-1",
      _type: "order",
      remnant: {_type: "reference", _ref: "remnant-1"},
      template: {_type: "reference", _ref: "template-cushion"},
      price: 84.5,
      ownerShare: 18.25,
    });
    expect(created).not.toHaveProperty("buyerName");
    expect(created).not.toHaveProperty("buyerEmail");
    expect(created).toHaveProperty("buyerContact");
    expect(created).toHaveProperty("requestFingerprint");
    expect(JSON.stringify(client.transactionValue.operations)).not.toContain("A Buyer");
    expect(JSON.stringify(client.transactionValue.operations)).not.toContain("buyer@example.com");
    expect(decryptBuyerContact(created.buyerContact)).toEqual({
      buyerName: "A Buyer",
      buyerEmail: "buyer@example.com",
    });
    expect(created.placement).toEqual([
      {_key: "placement-1", _type: "placement", x: 4, y: 5, w: 44, h: 44, rotated: false},
      {_key: "placement-2", _type: "placement", x: 60, y: 5, w: 20, h: 30, rotated: true},
    ]);
    expect(patch).toMatchObject({
      id: "remnant-1",
      ifRevisionID: "rev-1",
      set: {status: "allocated"},
      setIfMissing: {allocations: []},
      insert: {after: "allocations[-1]"},
    });
    expect(allocations).toEqual([
      {
        _key: "allocation-orders.order-1-1",
        _type: "allocation",
        x: 4,
        y: 5,
        w: 44,
        h: 44,
        order: {_type: "reference", _ref: "orders.order-1"},
      },
      {
        _key: "allocation-orders.order-1-2",
        _type: "allocation",
        x: 60,
        y: 5,
        w: 20,
        h: 30,
        order: {_type: "reference", _ref: "orders.order-1"},
      },
    ]);
  });

  it("rejects malformed or overlapping geometry before a write", async () => {
    const client = fakeClient();
    await expect(
      commitAllocatedOrder(
        {...orderInput, placement: [{x: 0, y: 0, w: 10, h: 10, rotated: false}, {x: 5, y: 5, w: 10, h: 10, rotated: false}]},
        client,
      ),
    ).rejects.toBeInstanceOf(SanityDataValidationError);
    expect(client.transactionValue.operations).toHaveLength(0);
  });

  it("normalizes a Sanity revision mismatch into the route-mappable conflict error", async () => {
    const transaction = new FakeTransaction();
    transaction.commitError = {
      statusCode: 409,
      body: {error: {type: "mutationError", items: [{error: {type: "revisionMismatch"}}]}},
    };
    const failure = commitAllocatedOrder(orderInput, fakeClient(transaction));
    await expect(failure).rejects.toBeInstanceOf(SanityRevisionConflictError);
    try {
      await failure;
    } catch (error) {
      expect(isSanityRevisionConflict(error)).toBe(true);
    }
  });

  it("keeps unrelated Sanity failures distinct", async () => {
    const failure = new Error("permission denied");
    const transaction = new FakeTransaction();
    transaction.commitError = failure;
    await expect(commitAllocatedOrder(orderInput, fakeClient(transaction))).rejects.toBe(failure);
    expect(isSanityRevisionConflict(failure)).toBe(false);
  });

  it("uses a fresh IV for every encrypted contact", async () => {
    const firstClient = fakeClient();
    const secondClient = fakeClient();
    await commitAllocatedOrder(orderInput, firstClient);
    await commitAllocatedOrder({...orderInput, orderId: "orders.order-2"}, secondClient);
    const first = (firstClient.transactionValue.operations[2]?.create as Record<string, unknown>).buyerContact;
    const second = (secondClient.transactionValue.operations[2]?.create as Record<string, unknown>).buyerContact;
    expect(first).toMatchObject({algorithm: "aes-256-gcm", version: 1});
    expect(second).toMatchObject({algorithm: "aes-256-gcm", version: 1});
    expect((first as Record<string, unknown>).iv).not.toBe((second as Record<string, unknown>).iv);
  });

  it("rejects a missing or invalid encryption key without exposing it", async () => {
    delete process.env.ORDER_ENCRYPTION_KEY;
    await expect(commitAllocatedOrder(orderInput, fakeClient())).rejects.toThrow(/ORDER_ENCRYPTION_KEY/);
    process.env.ORDER_ENCRYPTION_KEY = "super-secret";
    await expect(commitAllocatedOrder(orderInput, fakeClient())).rejects.toThrow(/Invalid ORDER_ENCRYPTION_KEY/);
    await expect(commitAllocatedOrder(orderInput, fakeClient())).rejects.not.toThrow("super-secret");
    process.env.ORDER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });
});

describe("order replay", () => {
  beforeEach(() => {
    process.env.ORDER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  const replayInput: OrderReplayInput = {
    orderId: "orders.order-1",
    remnantId: "remnant-1",
    templateId: "template-cushion",
    buyerName: "A Buyer",
    buyerEmail: "buyer@example.com",
    idempotencyKey: "checkout-1",
  };

  const replayProjection = {
    _id: "orders.order-1",
    _type: "order",
    remnant: {_type: "reference", _ref: "remnant-1"},
    template: {_type: "reference", _ref: "template-cushion"},
    placement: [{x: 4, y: 5, w: 44, h: 44, rotated: false}],
    price: 84.5,
    ownerShare: 18.25,
    workflowInstanceId: "workflow-order-1",
    createdAt: "2026-10-02T21:00:00.000Z",
    requestFingerprint: "",
    buyerContact: {
      algorithm: "aes-256-gcm",
      version: 1,
      iv: Buffer.alloc(12, 1).toString("base64"),
      authTag: Buffer.alloc(16, 2).toString("base64"),
      ciphertext: Buffer.from("ciphertext").toString("base64"),
    },
  };

  function replayClient(projection: unknown) {
    const getDocument = vi.fn(async () => projection);
    return {
      getDocument: getDocument as unknown as SanityDocumentReadClient["getDocument"],
      getDocumentMock: getDocument,
    };
  }

  it("matches the keyed request fingerprint and derives used area", async () => {
    const committed = fakeClient();
    await commitAllocatedOrder({...orderInput, idempotencyKey: "checkout-1"}, committed);
    const created = committed.transactionValue.operations[2]?.create as Record<string, unknown>;
    const projection = {...replayProjection, requestFingerprint: created.requestFingerprint, buyerContact: created.buyerContact};
    const client = replayClient(projection);
    const result = await fetchOrderReplay(replayInput, client);
    expect(client.getDocumentMock).toHaveBeenCalledWith("orders.order-1");
    expect(result).toMatchObject({
      status: "matched",
      orderId: "orders.order-1",
      remnantId: "remnant-1",
      templateId: "template-cushion",
      usedArea: 44 * 44,
      workflowInstanceId: "workflow-order-1",
    });
  });

  it("distinguishes missing orders and fingerprint mismatches", async () => {
    await expect(fetchOrderReplay(replayInput, replayClient(null))).resolves.toEqual({status: "missing"});
    const mismatch = {...replayProjection, requestFingerprint: "0".repeat(64)};
    await expect(fetchOrderReplay(replayInput, replayClient(mismatch))).resolves.toEqual({status: "mismatch"});
  });

  it("checks order existence and rejects malformed projections", async () => {
    await expect(hasCommittedOrder("orders.order-1", replayClient(null))).resolves.toBe(false);
    await expect(hasCommittedOrder("orders.order-1", replayClient({_id: "orders.order-1", _type: "order"}))).resolves.toBe(true);
    await expect(hasCommittedOrder("orders.order-1", replayClient({_id: "other", _type: "order"}))).rejects.toBeInstanceOf(
      SanityDataValidationError,
    );
    await expect(fetchOrderReplay(replayInput, replayClient({...replayProjection, placement: []}))).rejects.toBeInstanceOf(
      SanityDataValidationError,
    );
  });
});
