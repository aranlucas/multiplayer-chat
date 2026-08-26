import { describe, expect, it } from "vitest";
import { parseExecuteRequest } from "./protocol";
import { parseGitChangePaths } from "../src/shared/workspace-change";

const valid = {
  roomID: "live-ox",
  repository: "cloudflare/workers-chat-demo",
  commitSHA: "a".repeat(40),
  changes: [{ path: "src/index.ts", content: "export {};\n" }],
  command: "pnpm test",
};

describe("Microsandbox runner protocol", () => {
  it("accepts a commit-pinned command request", () => {
    expect(parseExecuteRequest(valid)).toMatchObject({
      ...valid,
      timeoutMs: 300_000,
    });
  });

  it("accepts dangerous-mode commands with a bounded timeout", () => {
    expect(
      parseExecuteRequest({
        ...valid,
        command: "npm test",
        timeoutMs: 60_000,
      }).command,
    ).toBe("npm test");
  });

  it.each(["../secret", "/etc/passwd", "src\\escape.ts"])(
    "rejects unsafe changed path %s",
    (path) => {
      expect(() =>
        parseExecuteRequest({ ...valid, changes: [{ path, content: "x" }] }),
      ).toThrow("Invalid changed file path");
    },
  );

  it("rejects a branch name in place of an exact commit", () => {
    expect(() => parseExecuteRequest({ ...valid, commitSHA: "main" })).toThrow(
      "Invalid commit SHA",
    );
  });

  it("accepts deletion markers in the shared overlay", () => {
    expect(
      parseExecuteRequest({
        ...valid,
        changes: [{ path: "src/removed.ts", content: null }],
      }).changes,
    ).toEqual([{ path: "src/removed.ts", content: null }]);
  });

  it("parses modified, renamed, deleted, and untracked Git paths", () => {
    expect(
      parseGitChangePaths(
        "M\0src/a.ts\0D\0src/b.ts\0R100\0src/old.ts\0src/new.ts\0",
        "src/untracked.ts\0",
      ),
    ).toEqual([
      { path: "src/a.ts", deleted: false },
      { path: "src/b.ts", deleted: true },
      { path: "src/new.ts", deleted: false },
      { path: "src/old.ts", deleted: true },
      { path: "src/untracked.ts", deleted: false },
    ]);
  });
});
