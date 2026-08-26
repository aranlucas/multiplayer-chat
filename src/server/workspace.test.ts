import { describe, expect, it } from "vitest";
import { applyUnifiedDiff } from "./unified-diff";

describe("applyUnifiedDiff", () => {
  it("applies an exact unified diff to a commit-pinned file", () => {
    const files = new Map([["README.md", "one\ntwo\nthree\n"]]);
    const changes = applyUnifiedDiff(
      files,
      [
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1,3 +1,4 @@",
        " one",
        "-two",
        "+two updated",
        "+two and a half",
        " three",
        "",
      ].join("\n"),
    );

    expect(changes).toEqual([
      {
        path: "README.md",
        original: "one\ntwo\nthree\n",
        content: "one\ntwo updated\ntwo and a half\nthree\n",
      },
    ]);
  });

  it("rejects mismatched context", () => {
    expect(() =>
      applyUnifiedDiff(
        new Map([["README.md", "actual\n"]]),
        "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-expected\n+changed\n",
      ),
    ).toThrow("Patch context did not match");
  });
});
