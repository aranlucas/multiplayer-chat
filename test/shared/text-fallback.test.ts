import { describe, expect, it } from "vitest";
import { textOrFallback } from "@/shared/text-fallback";

describe("textOrFallback", () => {
  it("falls back for null, undefined, and empty text", () => {
    expect(textOrFallback(null, "fallback")).toBe("fallback");
    expect(textOrFallback(undefined, "fallback")).toBe("fallback");
    expect(textOrFallback("", "fallback")).toBe("fallback");
  });

  it("preserves nonempty text including meaningful whitespace", () => {
    expect(textOrFallback("value", "fallback")).toBe("value");
    expect(textOrFallback("  ", "fallback")).toBe("  ");
    expect(textOrFallback("0", "fallback")).toBe("0");
  });
});
