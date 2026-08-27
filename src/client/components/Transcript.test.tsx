import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../../shared/protocol";
import { Transcript } from "./Transcript";

function toolEvent(
  tool: string,
  lifecycle: "called" | "success" | "failed",
  input: Record<string, unknown>,
): TimelineEvent {
  return {
    seq: 1,
    id: `${tool}-${lifecycle}`,
    kind: "opencode",
    createdAt: 1,
    payload: {
      type: "raw",
      event: {
        type: `session.tool.${lifecycle}`,
        data: {
          tool,
          input,
          ...(lifecycle === "success"
            ? { content: [{ type: "text", text: "ok" }] }
            : {}),
          ...(lifecycle === "failed" ? { error: "boom" } : {}),
        },
      },
    },
  };
}

function render(event: TimelineEvent) {
  return renderToStaticMarkup(
    <Transcript
      events={[event]}
      canApprove={false}
      onReply={() => {}}
      onQuestionReply={() => true}
      onQuestionCancel={() => true}
    />,
  );
}

function hasCopyButton(html: string) {
  return html.includes('aria-label="Copy command"');
}

describe("Bash tool card copy button", () => {
  it("renders for a completed Bash tool", () => {
    const html = render(
      toolEvent("bash", "success", { command: "git status --short" }),
    );
    expect(hasCopyButton(html)).toBe(true);
    expect(html).toContain('title="Copy command"');
  });

  it("does not render for running, failed, or non-Bash tools", () => {
    expect(
      hasCopyButton(render(toolEvent("bash", "called", { command: "pwd" }))),
    ).toBe(false);
    expect(
      hasCopyButton(render(toolEvent("bash", "failed", { command: "false" }))),
    ).toBe(false);
    expect(
      hasCopyButton(
        render(toolEvent("edit", "success", { filePath: "src/index.ts" })),
      ),
    ).toBe(false);
  });

  it("keeps the copy button outside the expand toggle", () => {
    const html = render(
      toolEvent("bash", "success", { command: "pnpm test" }),
    );
    expect(html).toContain('class="tool-header-wrap"');
    expect(html).toContain('class="tool-copy"');
  });
});

describe("question card", () => {
  it("renders choices, multi-select controls, and a custom answer", () => {
    const html = render({
      seq: 2,
      id: "question",
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
                      value: "Document API/protocol",
                      label: "Document API/protocol",
                      description: "Add WebSocket protocol details",
                    },
                  ],
                  custom: true,
                },
              ],
            },
          },
        },
      },
    });

    expect(html).toContain("OpenCode has a question");
    expect(html).toContain("README updates");
    expect(html).toContain("Document API/protocol");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Type your own answer");
    expect(html).toContain("Submit answer");
  });
});
