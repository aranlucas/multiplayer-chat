import { describe, expect, it } from "vitest";
import {
  parseOpenCodeInterruptRequest,
  parseOpenCodeTurnRequest,
} from "./protocol";
import { parseGitChangePaths } from "../src/shared/workspace-change";

const valid = {
  roomID: "live-ox",
  repository: "aranlucas/multiplayer-chat",
  commitSHA: "a".repeat(40),
  changes: [{ path: "src/index.ts", content: "export {};\n" }],
  prompt: "Add a copy button and test it",
  delivery: "steer",
  model: "opencode/hy3-free",
};

describe("Microsandbox native OpenCode protocol", () => {
  it("accepts a commit-pinned native agent turn", () => {
    expect(parseOpenCodeTurnRequest(valid)).toMatchObject({
      ...valid,
      timeoutMs: 600_000,
    });
  });

  it("accepts a persistent session and durable event cursor", () => {
    expect(
      parseOpenCodeTurnRequest({
        ...valid,
        sessionID: "ses_abc-123",
        after: "evt:42",
        delivery: "queue",
      }),
    ).toMatchObject({
      sessionID: "ses_abc-123",
      after: "evt:42",
      delivery: "queue",
    });
  });

  it("accepts an interrupt for a room session", () => {
    expect(
      parseOpenCodeInterruptRequest({ roomID: "live-ox", sessionID: "ses_1" }),
    ).toEqual({ roomID: "live-ox", sessionID: "ses_1" });
  });

  it.each(["../secret", "/etc/passwd", "src\\escape.ts"])(
    "rejects unsafe changed path %s",
    (path) => {
      expect(() =>
        parseOpenCodeTurnRequest({
          ...valid,
          changes: [{ path, content: "x" }],
        }),
      ).toThrow("Invalid changed file path");
    },
  );

  it("rejects a branch name in place of an exact commit", () => {
    expect(() =>
      parseOpenCodeTurnRequest({ ...valid, commitSHA: "main" }),
    ).toThrow("Invalid commit SHA");
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
