import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../shared/protocol";
import { coalesceTimelineEvents } from "./coalesce-events";

function raw(
  seq: number,
  type: string,
  data: Record<string, unknown>,
): TimelineEvent {
  return {
    seq,
    id: `event-${seq}`,
    kind: "opencode",
    createdAt: seq,
    payload: { type: "raw", event: { type, data } },
  };
}

describe("coalesceTimelineEvents", () => {
  it("streams one reasoning message instead of one event per delta", () => {
    const identity = {
      sessionID: "session",
      assistantMessageID: "message",
      ordinal: 0,
    };
    const events = coalesceTimelineEvents([
      raw(1, "session.reasoning.started", identity),
      raw(2, "session.reasoning.delta", { ...identity, delta: "Inspecting " }),
      raw(3, "session.reasoning.delta", {
        ...identity,
        delta: "the repository.",
      }),
    ]);
    expect(events).toHaveLength(1);
    expect(
      (events[0].payload.event as { data: { delta: string } }).data.delta,
    ).toBe("Inspecting the repository.");
  });

  it("uses the authoritative completed text and removes boundary events", () => {
    const identity = {
      sessionID: "session",
      assistantMessageID: "message",
      ordinal: 0,
    };
    const events = coalesceTimelineEvents([
      raw(1, "session.text.started", identity),
      raw(2, "session.text.delta", { ...identity, delta: "Partial" }),
      raw(3, "session.text.ended", { ...identity, text: "Complete response." }),
    ]);
    expect(events).toHaveLength(1);
    const data = (
      events[0].payload.event as { data: { delta: string; streaming: boolean } }
    ).data;
    expect(data).toEqual(
      expect.objectContaining({
        delta: "Complete response.",
        streaming: false,
      }),
    );
  });

  it("keeps a completed stream closed when later events are coalesced", () => {
    const identity = {
      sessionID: "session",
      assistantMessageID: "message",
      ordinal: 0,
    };
    const completed = coalesceTimelineEvents([
      raw(1, "session.reasoning.delta", {
        ...identity,
        delta: "Finished thought.",
      }),
      raw(2, "session.reasoning.ended", {
        ...identity,
        text: "Finished thought.",
      }),
    ]);
    const repeated = coalesceTimelineEvents([
      ...completed,
      raw(3, "session.usage.updated", { sessionID: "session" }),
    ]);

    expect(
      (
        repeated[0].payload.event as {
          data: { streaming: boolean };
        }
      ).data.streaming,
    ).toBe(false);
  });

  it("keeps separate assistant messages separate", () => {
    const events = coalesceTimelineEvents([
      raw(1, "session.text.delta", {
        sessionID: "s",
        assistantMessageID: "one",
        ordinal: 0,
        delta: "One",
      }),
      raw(2, "session.text.delta", {
        sessionID: "s",
        assistantMessageID: "two",
        ordinal: 0,
        delta: "Two",
      }),
    ]);
    expect(
      events.map(
        (event) =>
          (event.payload.event as { data: { delta: string } }).data.delta,
      ),
    ).toEqual(["One", "Two"]);
  });

  it("drops empty stream boundaries", () => {
    expect(
      coalesceTimelineEvents([
        raw(1, "session.reasoning.started", {
          sessionID: "session",
          assistantMessageID: "message",
        }),
        raw(2, "session.reasoning.ended", {
          sessionID: "session",
          assistantMessageID: "message",
          text: "",
        }),
      ]),
    ).toEqual([]);
  });

  it("renders one card for a complete tool lifecycle", () => {
    const identity = {
      sessionID: "session",
      assistantMessageID: "message",
      id: "call-1",
    };
    const events = coalesceTimelineEvents([
      raw(1, "session.tool.input.started", { ...identity, name: "shell" }),
      raw(2, "session.tool.input.ended", {
        ...identity,
        text: JSON.stringify({ command: "pnpm test" }),
      }),
      raw(3, "session.tool.called", {
        ...identity,
        input: { command: "pnpm test" },
        executed: true,
      }),
      raw(4, "session.tool.progress", {
        ...identity,
        metadata: { status: "Running" },
      }),
      raw(5, "session.tool.success", {
        ...identity,
        content: [{ type: "text", text: "passed" }],
        executed: true,
      }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].id).toContain("call-1");
    expect(events[0].payload.event).toMatchObject({
      type: "session.tool.success",
      data: {
        tool: "shell",
        input: { command: "pnpm test" },
        content: [{ type: "text", text: "passed" }],
      },
    });
  });

  it("coalesces native OpenCode tool events by callID", () => {
    const identity = {
      sessionID: "session",
      assistantMessageID: "message",
      callID: "native-call-1",
    };
    const events = coalesceTimelineEvents([
      raw(1, "session.tool.input.started", { ...identity, name: "bash" }),
      raw(2, "session.tool.input.ended", {
        ...identity,
        text: JSON.stringify({ command: "git status --short" }),
      }),
      raw(3, "session.tool.called", {
        ...identity,
        tool: "bash",
        input: { command: "git status --short" },
      }),
      raw(4, "session.tool.success", {
        ...identity,
        content: [{ type: "text", text: "clean" }],
      }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].id).toContain("native-call-1");
    expect(events[0].payload.event).toMatchObject({
      type: "session.tool.success",
      data: {
        tool: "bash",
        input: { command: "git status --short" },
        content: [{ type: "text", text: "clean" }],
      },
    });
  });

  it("keeps one interactive card across a question form lifecycle", () => {
    const form = {
      id: "frm_1",
      sessionID: "session",
      title: "Questions",
      metadata: { kind: "question" },
      fields: [
        {
          key: "q0",
          title: "README updates",
          description: "What should change?",
          type: "multiselect",
          options: [],
          custom: true,
        },
      ],
    };
    const events = coalesceTimelineEvents([
      raw(1, "form.created", { form }),
      raw(2, "form.replied", {
        id: "frm_1",
        sessionID: "session",
        answer: { q0: ["Document API/protocol"] },
      }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: "form:frm_1", createdAt: 1 });
    expect(events[0].payload.event).toMatchObject({
      type: "form.replied",
      data: {
        form,
        answer: { q0: ["Document API/protocol"] },
      },
    });
  });
});
