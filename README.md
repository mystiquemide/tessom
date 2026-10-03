# Tessom

Every offcut has a next piece. Leftover upholstery fabric, cut into one-off cushions, pads and totes. The schema decides what is for sale.

![A cut plan: dashed blue panels drawn on a real offcut, with a hatched flaw kept clear](public/readme/cut-plan.png)

| | |
|---|---|
| Live site | https://tessom.midelabs.xyz |
| Sanity project ID | `59g78icb` |
| Dataset | `production` (public read) |
| DEV post | Pending |

Built for the DEV x Sanity Challenge.

## Try it in 60 seconds

Workshop PIN for the live site: `tessom-judges-2026`

1. Open `/shop` and pick a fabric. Hover a cut and the plan redraws it on the real photo.
2. Open the same piece in a second tab. Order the same cut in both. One order is accepted and the other gets a conflict.
3. Open `/workshop`, enter the PIN, and move your order along: cut, sewn, shipped. The buyer's page at `/order/[id]` follows.
4. On the board, open the Awaiting consent column and press Copy owner link. Open it, and approve or decline the offcut. That is the Workflows consent stage.
5. Query the live data yourself. See the two queries below.

## Where to look for each judging criterion

| Criterion | Where |
|---|---|
| App functionality | The 60-second flow above. Every step runs against the live Sanity project |
| Schema thoughtfulness | [Schema](#schema) and [Why the schema looks like this](#why-the-schema-looks-like-this) |
| Workflows bonus | [Workflow](#workflow). Consent, allocation and production are real stages, with an allocation guard |
| Creativity | The cut plan: dashed panels drawn on the real fabric photo, with flaws kept clear |
| Build process | [What broke, and how I fixed it](#what-broke-and-how-i-fixed-it), and the tests that pin each fix |

## How it works

```
Sanity Studio -> Content Lake -> offer engine -> storefront -> Workflows
 (log offcuts)   (public data)   (fits + prices)   (/shop)     (consent to shipped)
```

A workshop logs an offcut with its size, pattern repeat, direction, flaws and a photo. The owner says yes before it is listed. On every read, the offer engine fits each product pattern onto the free fabric and prices the fit. Offers are never stored, so nothing can go stale. An order locks the exact area it uses, so every other cut that needs it disappears.

## Schema

| Type | Holds |
|---|---|
| `owner` | name, email, kind (client, designer, workshop), `shareBps` |
| `remnant` | title, fabric (name, maker, value per metre), size, `repeat`, `directional`, `defects[]`, photo, `owner`, `status`, `allocations[]` |
| `productTemplate` | name, kind, `pieces[]` (label, size, quantity), `seamCm`, `labourMin`, `fillCost`, image |
| `order` | `remnant`, `template`, `placement[]`, price, `ownerShare`, `buyerContact` (encrypted), `workflowInstanceId` |

The remnant owns its allocations, so what is sold lives in one place. Orders use a private ID path, so the public dataset returns none of them.

Paste these into a terminal:

```sh
# Every offcut, its owner, and how many areas are already sold
curl -s -G 'https://59g78icb.api.sanity.io/v2025-02-19/data/query/production' \
  --data-urlencode 'query=*[_type=="remnant"]{title,status,"owner":owner->name,"areasSold":count(allocations)}'

# Every workflow instance and the stage it is in
curl -s -G 'https://59g78icb.api.sanity.io/v2025-02-19/data/query/production' \
  --data-urlencode 'query=*[_type=="sanity.workflow.instance"]{_id,currentStage}'
```

Orders are not readable without a token:

```sh
curl -s -G 'https://59g78icb.api.sanity.io/v2025-02-19/data/query/production' \
  --data-urlencode 'query=*[_type=="order"]'
```

## Why the schema looks like this

| Decision | Why |
|---|---|
| Allocations live on the remnant | What is sold has one source of truth. The offer engine reads it, and the order route writes it with the remnant's revision, so two buyers cannot both win |
| Offers are computed on read, never stored | A stored offer can go stale the moment another order lands. Computing it means a sold area simply stops being offered |
| Consent is a workflow stage, not a boolean | Whose permission a piece needs, and when it was given, is the Workflows story. It also means the shop cannot list an unconsented piece |
| The workflow guard and the area lock check the same thing | Two sources of truth would disagree in front of a judge |
| Orders use a private ID path and an encrypted contact | The dataset is public. The public API returns no orders, and the buyer's name and email are ciphertext |
| The server recomputes every offer on order | The request carries only IDs and a fingerprint. Geometry and price are never taken from the client |

## Workflow

```
awaiting-consent --grant--> listed --allocate--> allocated --mark-cut--> cut
       |                       ^                                           |
    decline                    |                                      mark-sewn
       v                       |                                           v
    returned            (fabric left over)   <--- shipped <--mark-shipped-- sewn
                                                     |
                                                     +--> sold-out (nothing left)
```

| Action | Fired by | How it is authorised |
|---|---|---|
| `grant`, `decline` | The fabric's owner | A private link signed for that owner |
| `allocate` | A buyer placing an order | The order API recomputes the offer, then locks the area |
| `mark-cut`, `mark-sewn`, `mark-shipped` | The workshop | The workshop PIN |

Sanity Workflows 0.36 has no background runtime, so every route that changes data advances the workflow itself. The allocation guard and the area lock check the same thing, so they cannot disagree.

## 11 ways I tried to break it

The suite has 249 tests across 30 files.

| Attempt | Outcome | Proof |
|---|---|---|
| Rotate pieces on a directional fabric | Refused | [offers.test.ts](tests/offers/offers.test.ts) |
| Cut over a flaw or an area already sold | Never offered | [offers.test.ts](tests/offers/offers.test.ts) |
| Ignore the pattern repeat | Panels snap to repeat multiples, or the offer is dropped | [offers.test.ts](tests/offers/offers.test.ts) |
| Price an offer below the margin floor | Offer dropped | [offers.test.ts](tests/offers/offers.test.ts) |
| Two buyers, same area | One order, one conflict | [order-service.test.ts](tests/orders/order-service.test.ts) |
| Retry a checkout | The same key replays the same order | [order-service.test.ts](tests/orders/order-service.test.ts) |
| Read a buyer's contact from the dataset | Encrypted, fresh IV per order | [orders.test.ts](tests/sanity/orders.test.ts) |
| Move an order without the PIN | 401, and a lockout after ten wrong tries | [workflow-advance-route.test.ts](tests/api/workflow-advance-route.test.ts) |
| Decide consent with another owner's link | 401 | [owner-consent-route.test.ts](tests/api/owner-consent-route.test.ts) |
| Find a contact on the buyer order page | None is returned | [order-status.test.ts](tests/order-status.test.ts) |
| Re-seed over live orders | Refused without an explicit override | [seed.test.ts](tests/sanity/seed.test.ts) |

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
| `SANITY_API_WRITE_TOKEN` | Server-side writes. Never sent to the browser |
| `ORDER_ENCRYPTION_KEY` | 32 random bytes in base64. Encrypts buyer contacts and signs owner links |
| `WORKSHOP_PIN` | At least 12 characters. Unlocks `/workshop` |
| `WORKFLOW_TAG` | Names the workflow set, for example `tessom-dev` |
| `NEXT_PUBLIC_SITE_URL` | Public address, used for the share preview |
| `ALLOW_PRODUCTION_SEED`, `ALLOW_DESTRUCTIVE_SEED` | Deliberate overrides the seed script requires |

To set up your own project, run `npm run schema:deploy`, `npm run wf:deploy`, `npm run seed` and `npm run wf:bootstrap`.

## What broke, and how I fixed it

| What broke | How I found it | Fix |
|---|---|---|
| Fabric photo search returned ferns, CGI renders and real sand for fabric names | Reviewing contact sheets of every candidate | Renamed seven fabrics to match photos that really are textiles, instead of captioning a plant as a fabric |
| A template with no `labourMin` or `fillCost` silently produced no offer | A test fixture failed in a way that looked like a geometry bug | The engine prices only complete templates. Fixtures now carry both fields |
| The seed script does not delete orders or workflow instances | A reseed left old orders on the board | Remnants reference their orders, so the reset order matters: reseed first, then delete orders and instances, then rebuild the consent instances |
| A global `margin: 0` on headings overrode Tailwind spacing | An error page's headline sat off-centre | Removed the rule. Unlayered CSS beats utility classes |
| Adding loading skeletons made unknown pieces return HTTP 200 | Checking status codes after the change | Kept the skeletons. Those pages carry a noindex tag, and URLs that match no route still return 404 |
| My own UX audit found muted text at 3.65 to 4.06:1 contrast, no `<main>` on two pages, no security headers and an unthrottled order endpoint | A full browser audit at two widths | Darkened the muted colour, one `<main>` per page, headers and CSP, rate limits on orders and wrong PINs. Re-ran the audit: zero contrast failures |
| The first Vercel deploy failed with `No Output Directory named "dist"` | The build log | The build had passed. The project had no framework preset. Set it to Next.js and redeployed |

## Limitations

- No payments and no email. An order reserves the cut. The workshop reads the buyer's contact on its board and arranges payment and shipping by hand.
- Rectangles only. There is no irregular-shape nesting.
- The workshop uses one shared PIN. Wrong tries are rate-limited per address in memory, which slows a script on one server but is not shared across instances.
- Owner links have no expiry. Rotating `ORDER_ENCRYPTION_KEY` revokes them all, and also makes stored buyer contacts unreadable.
- Owner pages are public, so anyone can see each owner's accrued earnings. Owner emails sit in the public dataset. The seed data uses `example.com` addresses.
- The catalog is sample data. The 12 offcuts, 6 owners and fabric makers are invented. The photos are real, from Unsplash. There is no AI in Tessom.
- Sanity Workflows is early access (0.36).
- Unaudited hackathon code. Do not point it at real customers or payments.

## License

MIT. See [LICENSE](LICENSE).
