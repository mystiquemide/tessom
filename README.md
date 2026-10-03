# Tessom

Tessom turns upholstery remnants into orderable finished goods. A workshop records an offcut, the backend finds product patterns that fit its usable area, prices each feasible cut, records owner consent, and locks an allocation when a buyer places an order.

## Backend

- Local Sanity Studio schemas for owners, remnants, product templates, and orders.
- A pure offer engine that accounts for dimensions, seam allowance, defects, existing allocations, pattern repeats, directional fabric, pricing, and the margin floor.
- `GET /api/offers/:remnantId` for the current offers on a listed remnant.
- `POST /api/orders` for server-validated orders and optimistic remnant allocation.
- `POST /api/workflow/advance` for consent and workshop production actions.
- Sanity Studio configuration, deterministic seed data, and the remnant lifecycle workflow definition.

## Stack

Next.js 16 App Router, TypeScript, React, Sanity 6.17 Studio and Content Lake, Sanity Workflows 0.36, Zod, Tailwind CSS 4, and Vitest.

## Setup

Use Node.js and npm, then create a local environment file from the example:

```sh
npm install
cp .env.example .env.local
```

The environment variable names are:

```text
NEXT_PUBLIC_SANITY_PROJECT_ID
NEXT_PUBLIC_SANITY_DATASET
SANITY_API_WRITE_TOKEN
ORDER_ENCRYPTION_KEY
ALLOW_PRODUCTION_SEED
ALLOW_DESTRUCTIVE_SEED
WORKFLOW_TAG
WORKSHOP_PIN
GROQ_API_KEY
```

The intended public configuration targets Sanity project `59g78icb` and dataset `production`. The example uses the development workflow tag `tessom-dev`. Keep write access and workshop credentials in the local environment only.

`WORKSHOP_PIN` must be a long random secret of at least 12 characters. Send it in the accepted `x-workshop-pin` header when calling `POST /api/workflow/advance`.

`ORDER_ENCRYPTION_KEY` must contain exactly 32 random bytes encoded as canonical base64. Generate a new local value with `node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64"))'`, then copy the output into `.env.local`. Keep the key stable for existing orders. It protects buyer contact data and replay fingerprints. Buyer name and email are encrypted before entering the public dataset.

## Schema, data, and workflow commands

Run the commands from the repository root:

```sh
npm run schema:validate
npm run schema:deploy
npm run seed
npm run wf:deploy
npm run wf:bootstrap
```

`schema:validate` checks the local Studio schemas. The deploy, seed, and workflow commands write to the configured Sanity project when they pass their checks. The seed command probes the dataset before one transaction and reports completion only after Sanity acknowledges it. Production requires `ALLOW_PRODUCTION_SEED=1`; if orders, allocations, or allocated or sold-out remnants already exist, it also requires the deliberate `ALLOW_DESTRUCTIVE_SEED=1` override. The deterministic seed contains 6 owners, 5 product templates, and 12 remnants. Workflow bootstrap creates the consent instances used by those seeded remnants.

For local code checks:

```sh
npm run test:run
npm run typecheck
npm run lint
npm run build
```

## API shapes

`GET /api/offers/:remnantId` has no body. A successful response contains the remnant ID, its current revision, and an `offers` array. Each offer includes `templateId`, `placement`, `usedArea`, `price`, `ownerShare`, and a server generated `fingerprint`.

`POST /api/orders` accepts JSON shaped like this:

```json
{
  "remnantId": "remnant-01",
  "templateId": "template-01",
  "buyerName": "Buyer name",
  "buyerEmail": "buyer@example.com",
  "offerFingerprint": "offer-v1-...",
  "idempotencyKey": "checkout-01"
}
```

The fingerprint and idempotency key are optional. The server loads a fresh remnant and recomputes the selected offer, so the request does not supply trusted geometry, price, or owner share. A successful response includes the order and workflow IDs, placement, price, owner share, and creation time.

If the order is committed but workflow allocation needs recovery, `POST /api/orders` returns status 503 with `recoveryRequired: true`, `recoveryAction: "allocate"`, and a `workflowInstanceId`. Workflow instance IDs are random for each order attempt. Copy the returned value from the order response or recovery response.

`POST /api/workflow/advance` requires the `x-workshop-pin` header and accepts these JSON shapes:

```json
{"action":"grant","remnantId":"remnant-01","idempotencyKey":"consent-01"}
{"action":"decline","remnantId":"remnant-01"}
{"action":"mark-cut","workflowInstanceId":"<workflow-instance-id-returned-by-orders>"}
{"action":"mark-sewn","workflowInstanceId":"<workflow-instance-id-returned-by-orders>"}
{"action":"mark-shipped","workflowInstanceId":"<workflow-instance-id-returned-by-orders>"}
{"action":"allocate","workflowInstanceId":"<workflow-instance-id-returned-by-orders>","idempotencyKey":"allocate-retry-01"}
```

The consent actions use a remnant ID. Production actions use the lifecycle workflow instance ID returned by the order response or its recovery response. The ID is random and cannot be derived from the order ID or workflow tag. Every action accepts an optional idempotency key.

Use `allocate` only for the committed-order recovery response described above. It is protected by the same workshop PIN and requires the returned workflow instance ID.

## Concurrency and security

Orders use the current Sanity revision in an optimistic transaction. The remnant allocation and order are committed together, and a competing or stale allocation returns a conflict. The workflow guard checks the allocation before advancing the lifecycle, while server-side offer recomputation prevents clients from changing geometry or price. Repeated workflow actions use idempotent keys.

Sanity write access stays on the server. The workshop PIN is compared in constant time, route responses do not expose credentials, and public offers are returned with `no-store` caching. There is no payment processing or buyer account system in this backend.
