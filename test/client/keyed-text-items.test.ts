import { describe, expect, it } from "vitest";
import { keyedTextItems } from "@/client/keyed-text-items";

describe("keyed text items", () => {
  it("preserves order and duplicate text with unique keys", () => {
    const texts = ["same", "other", "same", "same:1", ""];
    const items = keyedTextItems(texts);

    expect(items.map((item) => item.text)).toEqual(texts);
    expect(new Set(items.map((item) => item.key)).size).toBe(texts.length);
  });

  it("keeps keys stable when other text is inserted or reordered", () => {
    const original = keyedTextItems(["first", "same", "last", "same"]);
    const reordered = keyedTextItems(["new", "last", "same", "first", "same"]);

    expect(reordered[1]).toEqual(original[2]);
    expect(reordered[2]).toEqual(original[1]);
    expect(reordered[3]).toEqual(original[0]);
    expect(reordered[4]).toEqual(original[3]);
  });

  it("does not mutate its input", () => {
    const items = Object.freeze(["second", "first", "second"]);

    expect(keyedTextItems(items).map((item) => item.text)).toEqual(items);
    expect(items).toEqual(["second", "first", "second"]);
  });
});
