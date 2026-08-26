import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../shared/protocol";
import { coalesceTimelineEvents } from "./coalesce-events";

function raw(seq: number, type: string, data: Record<string, unknown>): TimelineEvent {
  return { seq, id: `event-${seq}`, kind: "opencode", createdAt: seq, payload: { type: "raw", event: { type, data } } };
}

describe("coalesceTimelineEvents", () => {
  it("streams one reasoning message instead of one event per delta", () => {
    const identity = { sessionID: "session", assistantMessageID: "message", ordinal: 0 };
    const events = coalesceTimelineEvents([
      raw(1, "session.reasoning.started", identity),
      raw(2, "session.reasoning.delta", { ...identity, delta: "Inspecting " }),
      raw(3, "session.reasoning.delta", { ...identity, delta: "the repository." }),
    ]);
    expect(events).toHaveLength(1);
    expect(((events[0].payload.event as { data: { delta: string } }).data.delta)).toBe("Inspecting the repository.");
  });

  it("uses the authoritative completed text and removes boundary events", () => {
    const identity = { sessionID: "session", assistantMessageID: "message", ordinal: 0 };
    const events = coalesceTimelineEvents([
      raw(1, "session.text.started", identity),
      raw(2, "session.text.delta", { ...identity, delta: "Partial" }),
      raw(3, "session.text.ended", { ...identity, text: "Complete response." }),
    ]);
    expect(events).toHaveLength(1);
    const data = (events[0].payload.event as { data: { delta: string; streaming: boolean } }).data;
    expect(data).toEqual(expect.objectContaining({ delta: "Complete response.", streaming: false }));
  });

  it("keeps separate assistant messages separate", () => {
    const events = coalesceTimelineEvents([
      raw(1, "session.text.delta", { sessionID: "s", assistantMessageID: "one", ordinal: 0, delta: "One" }),
      raw(2, "session.text.delta", { sessionID: "s", assistantMessageID: "two", ordinal: 0, delta: "Two" }),
    ]);
    expect(events.map((event) => (event.payload.event as { data: { delta: string } }).data.delta)).toEqual(["One", "Two"]);
  });
});
