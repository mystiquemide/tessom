import {createCipheriv, randomBytes} from "node:crypto";
import {beforeEach, describe, expect, it, vi} from "vitest";

const KEY = randomBytes(32).toString("base64");
const PIN = "a-long-workshop-pin-123";
const ID = "submissions.0123456789abcdef";

function encrypt(buyerName: string, buyerEmail: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(KEY, "base64"), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({buyerName, buyerEmail}), "utf8"), cipher.final()]);
  return {algorithm: "aes-256-gcm", version: 1, iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64")};
}

const commit = vi.fn();
const patchSet = vi.fn();
const txn = {
  createIfNotExists: vi.fn(() => txn),
  patch: vi.fn(() => txn),
  commit,
};
const doc = vi.fn();
const fetchMock = vi.fn();
vi.mock("../../lib/sanity/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/sanity/client")>()),
  createSanityServerClient: () => ({
    fetch: fetchMock,
    getDocument: doc,
    transaction: () => txn,
    patch: () => ({set: (value: unknown) => ({ifRevisionId: () => ({commit: () => patchSet(value)})})}),
  }),
}));
const startConsent = vi.fn();
vi.mock("../../lib/workflow", () => ({startConsentInstance: (...args: unknown[]) => startConsent(...args)}));

import {GET as list} from "../../app/api/workshop/submissions/route";
import {POST as accept} from "../../app/api/workshop/submissions/accept/route";
import {POST as decline} from "../../app/api/workshop/submissions/decline/route";

const post = (handler: typeof accept, body: unknown, pin: string | null = PIN) =>
  handler(new Request("http://x/api", {method: "POST", headers: {"content-type": "application/json", ...(pin ? {"x-workshop-pin": pin} : {})}, body: JSON.stringify(body)}));

const stored = () => ({
  _id: ID, _type: "submission", _rev: "r1", status: "new", kind: "client", fabricName: "Willow Grid", maker: "Morrow Textiles",
  widthCm: 140, heightCm: 90, directional: true, notes: "Pulled thread", photo: {_type: "image", asset: {_ref: "image-abc-10x10-jpg"}},
  contact: encrypt("Ada Lovelace", "ada@example.com"),
});

beforeEach(() => {
  process.env.WORKSHOP_PIN = PIN;
  process.env.ORDER_ENCRYPTION_KEY = KEY;
  for (const mock of [commit, patchSet, doc, fetchMock, startConsent, txn.createIfNotExists, txn.patch]) mock.mockClear();
  doc.mockResolvedValue(stored());
  commit.mockResolvedValue({});
  patchSet.mockResolvedValue({});
  startConsent.mockResolvedValue({ok: true});
});

describe("workshop submissions", () => {
  it("every route needs the PIN", async () => {
    expect((await list(new Request("http://x/api"))).status).toBe(401);
    expect((await post(accept, {submissionId: ID, valuePerM: 40}, null)).status).toBe(401);
    expect((await post(decline, {submissionId: ID}, "wrong-wrong-wrong")).status).toBe(401);
    expect(commit).not.toHaveBeenCalled();
  });

  it("lists offers with a first name only, never the email", async () => {
    fetchMock.mockResolvedValue([stored()]);
    const body = await (await list(new Request("http://x/api", {headers: {"x-workshop-pin": PIN}}))).json();
    expect(body.submissions[0]).toMatchObject({id: ID, title: "Willow Grid", firstName: "Ada"});
    expect(JSON.stringify(body)).not.toContain("ada@example.com");
    expect(JSON.stringify(body)).not.toContain("Lovelace");
  });

  it("accepts: creates a pseudonymous owner and an intake remnant, then starts consent", async () => {
    const response = await post(accept, {submissionId: ID, valuePerM: 40});
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({remnantId: "remnant-0123456789abcdef", ownerId: "owner-0123456789abcdef", contact: {name: "Ada Lovelace", email: "ada@example.com"}});
    expect(body.ownerLink).toContain("/owner/owner-0123456789abcdef?key=");

    const [owner, remnant] = txn.createIfNotExists.mock.calls.map((call) => (call as unknown[])[0] as Record<string, unknown> & {photo: {asset: {_ref: string}}; name: string});
    expect(owner.name).toBe("Client 0123");
    expect(JSON.stringify(owner)).not.toContain("Ada");
    expect(JSON.stringify(owner)).not.toContain("ada@example.com");
    expect(remnant).toMatchObject({status: "intake", directional: true, allocations: [], fabric: {name: "Willow Grid", valuePerM: 40}});
    expect(remnant.photo.asset._ref).toBe("image-abc-10x10-jpg");
    expect((txn.patch as unknown as {mock: {calls: unknown[][]}}).mock.calls[0]).toEqual([ID, {set: expect.objectContaining({status: "accepted"}), ifRevisionID: "r1"}]);
    expect(startConsent).toHaveBeenCalledWith("remnant-0123456789abcdef");
  });

  it("refuses to accept the same offer twice, or one that doesn't exist", async () => {
    doc.mockResolvedValueOnce({...stored(), status: "accepted"});
    expect((await post(accept, {submissionId: ID, valuePerM: 40})).status).toBe(409);
    doc.mockResolvedValueOnce(null);
    expect((await post(accept, {submissionId: ID, valuePerM: 40})).status).toBe(404);
    expect(commit).not.toHaveBeenCalled();
  });

  it("validates the request", async () => {
    expect((await post(accept, {submissionId: "owner-1", valuePerM: 40})).status).toBe(400);
    expect((await post(accept, {submissionId: ID, valuePerM: 0})).status).toBe(400);
    expect((await post(accept, {submissionId: ID, valuePerM: 40, owner: "x"})).status).toBe(400);
  });

  it("says so when the saved remnant has no workflow yet", async () => {
    startConsent.mockResolvedValueOnce(undefined);
    expect((await post(accept, {submissionId: ID, valuePerM: 40})).status).toBe(502);
  });

  it("declines without deleting anything", async () => {
    expect((await post(decline, {submissionId: ID})).status).toBe(200);
    expect(patchSet).toHaveBeenCalledWith({status: "declined"});
    doc.mockResolvedValueOnce({...stored(), status: "declined"});
    expect((await post(decline, {submissionId: ID})).status).toBe(409);
  });
});
