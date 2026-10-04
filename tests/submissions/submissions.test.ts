import {describe, expect, it} from "vitest";

import {
  buildSubmissionDocument,
  detectPhotoType,
  newSubmissionId,
  publicSubmissionReference,
  submissionFieldsSchema,
} from "../../lib/submissions";

const valid = {name: "Ada", email: "ada@example.com", kind: "client", widthCm: "140", heightCm: "90"};

describe("detectPhotoType", () => {
  it("recognises jpeg, png and webp from their bytes", () => {
    expect(detectPhotoType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))?.contentType).toBe("image/jpeg");
    expect(detectPhotoType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.contentType).toBe("image/png");
    const webp = new TextEncoder().encode("RIFF1234WEBPVP8 ");
    expect(detectPhotoType(webp)?.contentType).toBe("image/webp");
  });

  it("refuses everything else, including a script renamed to .jpg", () => {
    expect(detectPhotoType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(detectPhotoType(new TextEncoder().encode("<?php echo 1;"))).toBeNull();
    expect(detectPhotoType(new Uint8Array())).toBeNull();
  });
});

describe("submissionFieldsSchema", () => {
  it("accepts a valid offer and applies defaults", () => {
    const parsed = submissionFieldsSchema.parse(valid);
    expect(parsed).toMatchObject({widthCm: 140, heightCm: 90, directional: false, fabricName: "", notes: "", website: ""});
  });

  it("reads the directional checkbox", () => {
    expect(submissionFieldsSchema.parse({...valid, directional: "true"}).directional).toBe(true);
  });

  it.each([
    ["bad email", {email: "nope"}],
    ["unknown kind", {kind: "admin"}],
    ["tiny size", {widthCm: "5"}],
    ["huge size", {heightCm: "9000"}],
    ["not a number", {widthCm: "wide"}],
    ["empty name", {name: "  "}],
    ["notes too long", {notes: "x".repeat(1001)}],
    ["unexpected field", {status: "accepted"}],
  ])("rejects %s", (_label, patch) => {
    expect(submissionFieldsSchema.safeParse({...valid, ...patch}).success).toBe(false);
  });
});

describe("submission documents", () => {
  it("uses a private id path and carries only the encrypted contact", () => {
    const id = newSubmissionId();
    expect(id).toMatch(/^submissions\.[0-9a-f]{16}$/);
    expect(publicSubmissionReference(id)).toMatch(/^[0-9a-f]{16}$/);

    const fields = submissionFieldsSchema.parse(valid);
    const document = buildSubmissionDocument({
      id,
      fields,
      contact: {ciphertext: "x"},
      photoAssetId: "image-abc-10x10-png",
      now: new Date("2026-10-05T00:00:00Z"),
    });
    const serialised = JSON.stringify(document);
    expect(document).toMatchObject({_type: "submission", status: "new", contact: {ciphertext: "x"}});
    expect(serialised).not.toContain("ada@example.com");
    expect(serialised).not.toContain("Ada");
    expect(Object.keys(document)).not.toContain("owner");
  });

  it("never lets the submitter choose status or id", () => {
    const fields = submissionFieldsSchema.parse(valid);
    const document = buildSubmissionDocument({id: "submissions.aaaaaaaaaaaaaaaa", fields, contact: {}, photoAssetId: "image-a", now: new Date()});
    expect(document.status).toBe("new");
    expect(document._id).toBe("submissions.aaaaaaaaaaaaaaaa");
  });
});
