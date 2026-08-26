import { describe, expect, it } from "vitest";
import { replaceExact } from "../shared/exact-edit";

describe("replaceExact", () => {
  it("replaces one exact match", () => {
    expect(replaceExact("one\ntwo\nthree\n", "two", "updated", false)).toBe(
      "one\nupdated\nthree\n",
    );
  });

  it("requires a unique match unless replaceAll is enabled", () => {
    expect(() => replaceExact("same same", "same", "next", false)).toThrow(
      "multiple matches",
    );
    expect(replaceExact("same same", "same", "next", true)).toBe(
      "next next",
    );
  });

  it("directs the agent to re-read after stale content", () => {
    expect(() => replaceExact("actual", "stale", "next", false)).toThrow(
      "Re-read the file",
    );
  });
});
