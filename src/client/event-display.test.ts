import { describe, expect, it } from "vitest";
import { displayEvent } from "./event-display";
import type { TimelineEvent } from "../shared/protocol";

function rawToolEvent(tool: string, input: Record<string, unknown>) {
  return {
    seq: 1,
    id: "event",
    kind: "opencode",
    createdAt: 1,
    payload: {
      type: "raw",
      event: { type: "session.tool.called", data: { tool, input } },
    },
  } satisfies TimelineEvent;
}

describe("tool event display", () => {
  it("shows Bash commands without a serialized tool-call wrapper", () => {
    expect(
      displayEvent(rawToolEvent("bash", { command: "git status --short" })),
    ).toMatchObject({ title: "bash", detail: "$ git status --short" });
  });

  it("presents the shell compatibility alias as Bash", () => {
    expect(
      displayEvent(rawToolEvent("shell", { command: "pnpm test" })),
    ).toMatchObject({ title: "bash", detail: "$ pnpm test" });
  });

  it("keeps the command summary after a direct tool succeeds", () => {
    expect(
      displayEvent({
        ...rawToolEvent("bash", { command: "pnpm typecheck" }),
        payload: {
          type: "raw",
          event: {
            type: "session.tool.success",
            data: {
              tool: "bash",
              input: { command: "pnpm typecheck" },
              executed: false,
              content: [{ type: "text", text: "passed" }],
            },
          },
        },
      }),
    ).toMatchObject({
      title: "bash",
      detail: "$ pnpm typecheck",
      output: "passed",
      status: "completed",
    });
  });

  it("does not expose exact replacement contents in edit cards", () => {
    expect(
      displayEvent(
        rawToolEvent("edit", {
          filePath: "src/index.ts",
          oldString: "secret old content",
          newString: "secret new content",
        }),
      ),
    ).toMatchObject({ title: "edit", detail: "Editing src/index.ts" });
  });

  it("treats SDK error statuses as failed tools", () => {
    expect(
      displayEvent({
        seq: 1,
        id: "event",
        kind: "opencode",
        createdAt: 1,
        payload: { type: "tool", tool: "bash", status: "error" },
      }),
    ).toMatchObject({ title: "bash", status: "failed" });
  });
});
