import { describe, expect, it } from "vitest";
import { parseExecuteRequest } from "./protocol";

const valid = {
  roomID: "live-ox",
  repository: "cloudflare/workers-chat-demo",
  commitSHA: "a".repeat(40),
  changes: [{ path: "src/index.ts", content: "export {};\n" }],
  target: "test",
};

describe("Microsandbox runner protocol", () => {
  it("accepts a commit-pinned test request", () => {
    expect(parseExecuteRequest(valid)).toMatchObject({
      ...valid,
      timeoutMs: 300_000,
    });
  });

  it("accepts dangerous-mode commands with a bounded timeout", () => {
    expect(
      parseExecuteRequest({
        ...valid,
        target: undefined,
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
});
