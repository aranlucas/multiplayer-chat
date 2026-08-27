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

  it("exposes the exact command for a completed Bash tool", () => {
    expect(
      displayEvent({
        ...rawToolEvent("bash", { command: "git status --short" }),
        payload: {
          type: "raw",
          event: {
            type: "session.tool.success",
            data: {
              tool: "bash",
              input: { command: "git status --short" },
              executed: false,
              content: [{ type: "text", text: "passed" }],
            },
          },
        },
      }),
    ).toMatchObject({
      title: "bash",
      status: "completed",
      command: "git status --short",
    });
  });

  it("exposes the command for the shell alias as Bash", () => {
    expect(
      displayEvent({
        ...rawToolEvent("shell", { command: "pnpm test" }),
        payload: {
          type: "raw",
          event: {
            type: "session.tool.success",
            data: {
              tool: "shell",
              input: { command: "pnpm test" },
              executed: false,
              content: [{ type: "text", text: "passed" }],
            },
          },
        },
      }),
    ).toMatchObject({
      title: "bash",
      status: "completed",
      command: "pnpm test",
    });
  });

  it("does not expose a copyable command for non-Bash tools", () => {
    const display = displayEvent(
      rawToolEvent("edit", {
        filePath: "src/index.ts",
        oldString: "old",
        newString: "new",
      }),
    );
    expect(display).toMatchObject({ title: "edit" });
    expect("command" in display ? display.command : undefined).toBeUndefined();
  });

  it("keeps the copyable command free of its display prefix", () => {
    const display = displayEvent(
      rawToolEvent("bash", { command: "git status --short" }),
    );
    expect(display).toMatchObject({
      title: "bash",
      detail: "$ git status --short",
      command: "git status --short",
    });
    expect(
      "command" in display && display.command
        ? display.command.startsWith("$ ")
        : undefined,
    ).toBe(false);
  });

  it("summarizes a question tool call with the actual prompt", () => {
    expect(
      displayEvent(
        rawToolEvent("question", {
          questions: [
            {
              question: "What specific changes would you like made to the README?",
              header: "README updates",
              options: [],
              multiple: true,
            },
          ],
        }),
      ),
    ).toMatchObject({
      type: "tool",
      title: "question",
      detail: "What specific changes would you like made to the README?",
    });
  });
});

describe("question form display", () => {
  it("turns the OpenCode question form into an interactive display model", () => {
    const event = {
      seq: 2,
      id: "form-event",
      kind: "opencode",
      createdAt: 2,
      payload: {
        type: "raw",
        event: {
          type: "form.created",
          data: {
            form: {
              id: "frm_1",
              sessionID: "ses_1",
              title: "Questions",
              metadata: { kind: "question" },
              fields: [
                {
                  key: "q0",
                  title: "README updates",
                  description:
                    "What specific changes would you like made to the README?",
                  type: "multiselect",
                  options: [
                    {
                      value: "Add contributing guidelines",
                      label: "Add contributing guidelines",
                      description: "Add a CONTRIBUTING section",
                    },
                  ],
                  custom: true,
                },
              ],
            },
          },
        },
      },
    } satisfies TimelineEvent;

    expect(displayEvent(event)).toMatchObject({
      type: "question",
      title: "OpenCode has a question",
      formID: "frm_1",
      sessionID: "ses_1",
      status: "pending",
      fields: [
        {
          title: "README updates",
          type: "multiselect",
          custom: true,
          options: [{ label: "Add contributing guidelines" }],
        },
      ],
    });
  });
});
