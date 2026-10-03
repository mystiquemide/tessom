import {beforeEach, describe, expect, it, vi} from "vitest";

import {GET} from "../../app/api/offers/[remnantId]/route";
import {fingerprintOffer} from "../../lib/orders";
import {computeOffers} from "../../lib/offers";
import {DEFAULT_OFFER_RATES} from "../../lib/offers/rates";
import {fetchOrderContext} from "../../lib/sanity";

vi.mock("../../lib/sanity", () => ({
  fetchOrderContext: vi.fn(),
}));

const mockedFetchOrderContext = vi.mocked(fetchOrderContext);

const remnant = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

const templates = [
  {
    _id: "template-cushion",
    name: "Cushion",
    pieces: [{label: "front", wCm: 40, hCm: 40, centerPattern: false}],
    seamCm: 1,
    labourMin: 10,
    fillCost: 5,
    active: true,
  },
];

function requestFor(remnantId: string) {
  return new Request(`https://tessom.test/api/offers/${remnantId}`);
}

function routeContext(remnantId: string) {
  return {params: Promise.resolve({remnantId})};
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("GET /api/offers/[remnantId]", () => {
  beforeEach(() => {
    mockedFetchOrderContext.mockReset();
  });

  it("returns fresh listed offers with revision and fingerprints", async () => {
    const context = {remnant: remnant(), templates};
    mockedFetchOrderContext.mockResolvedValue(context);

    const response = await GET(requestFor("remnant-1"), routeContext("remnant-1"));
    const body = await json(response);
    const expected = computeOffers(context.remnant, templates, DEFAULT_OFFER_RATES);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      remnantId: "remnant-1",
      revision: "rev-1",
      offers: expected.map((offer) => ({...offer, fingerprint: fingerprintOffer(offer)})),
    });
    expect(body).not.toHaveProperty("title");
    expect(JSON.stringify(body)).not.toContain("Private title");
  });

  it("computes only the remaining allocated area", async () => {
    const context = {
      remnant: remnant({status: "allocated", allocations: [{x: 0, y: 0, w: 60, h: 100}]}),
      templates: [
        {
          ...templates[0],
          pieces: [{label: "remaining", wCm: 35, hCm: 35, centerPattern: false}],
        },
      ],
    };
    mockedFetchOrderContext.mockResolvedValue(context);

    const response = await GET(requestFor("remnant-1"), routeContext("remnant-1"));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.offers).toEqual(
      computeOffers(context.remnant, context.templates, DEFAULT_OFFER_RATES).map((offer) => ({
        ...offer,
        fingerprint: fingerprintOffer(offer),
      })),
    );
  });

  it("rejects an invalid path ID before reading Sanity", async () => {
    const response = await GET(requestFor("bad id!"), routeContext("bad id!"));

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({error: "Invalid remnant ID"});
    expect(mockedFetchOrderContext).not.toHaveBeenCalled();
  });

  it("hides a remnant that is not publicly available", async () => {
    mockedFetchOrderContext.mockResolvedValue({remnant: remnant({status: "consented"}), templates});

    const response = await GET(requestFor("remnant-1"), routeContext("remnant-1"));

    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({error: "Remnant not available"});
  });

  it("returns 404 when the remnant is missing", async () => {
    mockedFetchOrderContext.mockResolvedValue(null);

    const response = await GET(requestFor("remnant-1"), routeContext("remnant-1"));

    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({error: "Remnant not found"});
  });

  it("sanitizes internal failures", async () => {
    mockedFetchOrderContext.mockRejectedValue(new Error("secret Sanity token and stack"));

    const response = await GET(requestFor("remnant-1"), routeContext("remnant-1"));
    const body = await json(response);

    expect(response.status).toBe(500);
    expect(body).toEqual({error: "Unable to load offers"});
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
