import {beforeEach, describe, expect, it, vi} from "vitest";

const upload = vi.fn();
const create = vi.fn();

vi.mock("../../lib/sanity/client", () => ({
  createSanityServerClient: vi.fn(() => ({assets: {upload}, create})),
}));
vi.mock("../../lib/sanity/orders", () => ({
  encryptBuyerContact: vi.fn(() => ({ciphertext: "sealed"})),
}));

import {POST} from "../../app/api/submissions/route";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

async function submit(parts: Record<string, string>, photo?: Blob | null, extraHeaders: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(parts)) form.set(key, value);
  if (photo) form.set("photo", photo, "fabric.jpg");
  const probe = new Response(form);
  const contentType = probe.headers.get("content-type") ?? "";
  const body = new Uint8Array(await probe.arrayBuffer());
  return POST(
    new Request("http://localhost/api/submissions", {
      method: "POST",
      body,
      headers: {"content-type": contentType, "content-length": String(body.length), ...extraHeaders},
    }),
  );
}

const fields = {name: "Ada", email: "ada@example.com", kind: "client", widthCm: "140", heightCm: "90"};

beforeEach(() => {
  upload.mockReset().mockResolvedValue({_id: "image-abc-10x10-jpg"});
  create.mockReset().mockResolvedValue({});
});

describe("POST /api/submissions", () => {
  it("stores a valid offer privately and returns a reference", async () => {
    const response = await submit(fields, new Blob([JPEG], {type: "image/jpeg"}));
    expect(response.status).toBe(201);
    const {reference} = await response.json();
    expect(reference).toMatch(/^[0-9a-f]{16}$/);
    const document = create.mock.calls[0][0];
    expect(document._id).toBe(`submissions.${reference}`);
    expect(document.status).toBe("new");
    expect(JSON.stringify(document)).not.toContain("ada@example.com");
    expect(upload).toHaveBeenCalledWith("image", expect.any(Buffer), expect.objectContaining({contentType: "image/jpeg"}));
  });

  it("refuses a file that is not an image, whatever its name says", async () => {
    const response = await submit(fields, new Blob(["<svg onload=alert(1)>"], {type: "image/jpeg"}));
    expect(response.status).toBe(415);
    expect(upload).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("requires a photo", async () => {
    expect((await submit(fields, null)).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects invalid fields before touching Sanity", async () => {
    const response = await submit({...fields, email: "nope"}, new Blob([JPEG]));
    expect(response.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects an oversized form before reading it", async () => {
    const response = await submit(fields, new Blob([JPEG]), {"content-length": String(10 * 1024 * 1024)});
    expect(response.status).toBe(413);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects a request with no content length", async () => {
    const response = await POST(new Request("http://localhost/api/submissions", {method: "POST", body: "x", headers: {"content-type": "multipart/form-data; boundary=x"}}));
    expect(response.status).toBe(411);
  });

  it("answers a filled honeypot normally but stores nothing", async () => {
    const response = await submit({...fields, website: "http://spam.example"}, new Blob([JPEG]));
    expect(response.status).toBe(201);
    expect(create).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not leak server errors", async () => {
    create.mockRejectedValueOnce(new Error("token abc123 secret"));
    const response = await submit(fields, new Blob([JPEG]));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("abc123");
  });
});
