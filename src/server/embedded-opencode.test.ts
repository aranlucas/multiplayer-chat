import { describe, expect, it } from "vitest";
import { eventSessionID, openCodeModelRef } from "./embedded-opencode";

describe("openCodeModelRef", () => {
  it("preserves model IDs with nested path segments", () => {
    expect(openCodeModelRef("opencode/vendor/coding-free")).toEqual({
      providerID: "opencode",
      id: "vendor/coding-free",
    });
  });

  it("rejects incomplete model IDs", () => {
    expect(() => openCodeModelRef("hy3-free")).toThrow(
      "Invalid OpenCode model",
    );
    expect(() => openCodeModelRef("opencode/")).toThrow(
      "Invalid OpenCode model",
    );
  });
});

describe("eventSessionID", () => {
  it("finds the session on an OpenCode form.created event", () => {
    expect(
      eventSessionID({
        type: "form.created",
        data: { form: { id: "frm_1", sessionID: "ses_1" } },
      }),
    ).toBe("ses_1");
  });
});
