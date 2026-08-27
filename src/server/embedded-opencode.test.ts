import { describe, expect, it } from "vitest";
import { openCodeModelRef } from "./embedded-opencode";

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
