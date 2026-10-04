import {describe, expect, it} from "vitest";

import {buildOfferStatus} from "../../lib/submissions/status";

const REF = "0123456789abcdef";
const doc = {_type: "submission", status: "new", fabricName: "Willow Grid", widthCm: 140, heightCm: 90, contact: {ciphertext: "x"}, photo: {asset: {_ref: "image-a"}}};

describe("buildOfferStatus", () => {
  it("shows a new offer as waiting", () => {
    expect(buildOfferStatus(REF, doc)).toMatchObject({stage: "new", title: "Willow Grid", size: "140 × 90 cm", headline: "Waiting for the workshop"});
  });

  it("shows accepted and declined offers", () => {
    expect(buildOfferStatus(REF, {...doc, status: "accepted"})?.stage).toBe("accepted");
    expect(buildOfferStatus(REF, {...doc, status: "declined"})?.headline).toBe("Not taken this time");
  });

  it("never carries contact details, the photo or internal ids", () => {
    const text = JSON.stringify(buildOfferStatus(REF, {...doc, status: "accepted"}));
    expect(text).not.toContain("ciphertext");
    expect(text).not.toContain("image-a");
    expect(text).not.toContain("submissions.");
  });

  it("returns nothing for a bad reference, a missing document or another document type", () => {
    expect(buildOfferStatus("../etc", doc)).toBeNull();
    expect(buildOfferStatus("ABCDEF0123456789", doc)).toBeNull();
    expect(buildOfferStatus(REF, null)).toBeNull();
    expect(buildOfferStatus(REF, {...doc, _type: "order"})).toBeNull();
  });

  it("treats an unknown status as new", () => {
    expect(buildOfferStatus(REF, {...doc, status: "weird"})?.stage).toBe("new");
  });
});
