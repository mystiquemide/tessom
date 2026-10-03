# Tessom

Every offcut has a next piece. Built for the DEV x Sanity Challenge.

## The story

Premium upholstery fabric can cost $100 or more a yard. The leftovers from a job are usually too small for another job, so they sit in a bin. The bigger ones often belong to the client, so the shop can't sell them without asking.

Working out what a leftover can still become means checking its size, pattern repeat, nap direction and flaws by hand. For a one-off piece, nobody does it.

There is no personal receipt behind this project. The proof is below: a tested offer engine and a live Sanity project you can query yourself.

## One line

I did not build a fabric marketplace, a cut-list calculator, or a mockup. I built a shop where every offer is computed from the real piece of fabric, and ordering one cut removes that fabric from every other offer.

## How it works

A workshop logs an offcut with its size, pattern repeat, direction, flaws and a photo. The fabric's owner says yes before anything is listed. The offer engine fits every product pattern onto the free fabric and prices each fit. An order locks the exact area it uses, so every other cut that needs it disappears.

| Step | Who | What happens |
|---|---|---|
| Log | Workshop, in Sanity Studio at `/studio` | Size, repeat, direction, flaws, owner, photo |
| Consent | Owner, through a private link | Grant or decline. Nothing is listed until they grant |
| Offers | Server | Every template is fitted and priced. The client never supplies geometry or price |
| Order | Buyer, at `/r/[id]` | The area is locked. A second buyer for the same area gets a conflict |
| Production | Workshop, at `/workshop` behind a PIN | Allocated, cut, sewn, shipped. Each step is a Sanity Workflows action |
| Follow | Buyer, at `/order/[id]` | Live progress. No contact details are shown |
| Earnings | Owner, at `/owner/[id]` | Accrued share per piece. No payments are made |

## Try it in 2 minutes

The hosted app is not deployed yet. Two paths work today.

Query the live data. The dataset is public, so no token is needed:

```sh
curl -g 'https://59g78icb.api.sanity.io/v2025-02-19/data/query/production?query=count(*[_type=="remnant"])'
```

Run the app. See Run locally below. Then:

1. Open `/shop` and pick a fabric.
2. On the piece, hover an offer. The plan on the left redraws that cut on the real photo.
3. Order a cut. Open the same piece in a second tab and order the same cut. The second tab is refused.
4. Follow the order at `/order/[id]`, then move it along at `/workshop` with your PIN.

## 11 ways I tried to break it

The suite has 240 tests across 29 files.

| Attempt | Outcome | Proof |
|---|---|---|
| Rotate pieces on a directional fabric | Refused | [offers.test.ts](tests/offers/offers.test.ts) |
| Cut over a flaw or an area already sold | Never offered | [offers.test.ts](tests/offers/offers.test.ts) |
| Ignore the pattern repeat | Pieces snap to repeat multiples, or the offer is dropped | [offers.test.ts](tests/offers/offers.test.ts) |
| Price an offer below the margin floor | Offer dropped | [offers.test.ts](tests/offers/offers.test.ts) |
| Two buyers, same area | One order, one conflict, and no workflow starts for the loser | [order-service.test.ts](tests/orders/order-service.test.ts) |
| Retry a checkout | Same key replays the same order, never a second one | [order-service.test.ts](tests/orders/order-service.test.ts) |
| Read a buyer's contact from the dataset | Encrypted with a fresh IV per order | [orders.test.ts](tests/sanity/orders.test.ts) |
| Move an order without the PIN | 401 | [workflow-advance-route.test.ts](tests/api/workflow-advance-route.test.ts) |
| Decide consent with another owner's link | 401 | [owner-consent-route.test.ts](tests/api/owner-consent-route.test.ts) |
| Find a contact on the buyer order page | None is returned | [order-status.test.ts](tests/order-status.test.ts) |
| Re-seed over live orders | Refused without an explicit override | [seed.test.ts](tests/sanity/seed.test.ts) |

I also ran the two-buyer case by hand in two browser tabs against the live dataset.

## Live proof

| Item | Value |
|---|---|
| Sanity project ID | `59g78icb` |
| Dataset | `production`, public read |
| Studio | `/studio` in the app |
| Workflow | `remnant-lifecycle`, Sanity Workflows 0.36 |
| Hosted app | Pending deploy |

## Real usage

No real customers yet. The live dataset holds test orders I placed while building.

## How this differs

| Alternative | What it does | How Tessom differs |
|---|---|---|
| Yardage calculators | Start from a design and work out how much fabric to buy | Start from a leftover piece and work out what it can become |
| A rectangle-packing tutorial | Places boxes inside a box | Adds nap, repeat, flaws, pricing, owner consent, and a lock that holds against a second buyer |
| Listing the remnant as it is | Sells loose fabric | Sells finished goods, and routes consent and earnings to the owner |

## Honest limitations

- No payments and no email. An order reserves the cut. The workshop reads the buyer's contact on the board and arranges payment and shipping by hand.
- Rectangles only. There is no irregular-shape nesting.
- Owner links have no expiry. Rotating `ORDER_ENCRYPTION_KEY` revokes them all, but it also makes stored buyer contacts unreadable.
- Owner pages are public. Anyone can see each owner's accrued earnings.
- The workshop PIN is one shared secret, held in the browser's memory only.
- Sanity Workflows is early access (0.36) and has no background runtime, so route handlers drive every transition.
- Unaudited hackathon code. Do not point it at real customers or payments.

## What is real

The shipped path is real: pricing, the area lock, the workflow stages, encrypted contacts, the PIN and owner keys, all against a live Sanity project.

Not real: the 12 remnants, 6 owners and fabric makers are seed data I invented. The photos are real, from Unsplash. There is no AI in Tessom.

Status: 240 tests passing, typecheck, lint and build clean.

## Run locally

```sh
git clone https://github.com/mystiquemide/tessom && cd tessom
npm install
cp .env.example .env.local
npm run test:run
npm run dev
```

Browsing the shop needs no secrets. Orders, the workshop board and the owner pages need a write token for your own Sanity project.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SANITY_PROJECT_ID`, `NEXT_PUBLIC_SANITY_DATASET` | Which Sanity dataset to use |
| `SANITY_API_WRITE_TOKEN` | Server-side writes. Never exposed to the browser |
| `ORDER_ENCRYPTION_KEY` | 32 random bytes in base64. Encrypts buyer contacts and signs owner links |
| `WORKSHOP_PIN` | At least 12 characters. Unlocks `/workshop` |
| `WORKFLOW_TAG` | Names the workflow set, for example `tessom-dev` |
| `NEXT_PUBLIC_SITE_URL` | Public URL, used for the share preview image |
| `ALLOW_PRODUCTION_SEED`, `ALLOW_DESTRUCTIVE_SEED` | Deliberate overrides the seed script requires |

To set up your own project, run `npm run schema:deploy`, `npm run wf:deploy`, `npm run seed` and `npm run wf:bootstrap`.
