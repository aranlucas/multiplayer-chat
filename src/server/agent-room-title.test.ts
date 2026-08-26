import { describe, expect, it } from "vitest";
import { sessionTitleFromEvent } from "./session-title";

describe("sessionTitleFromEvent", () => {
  it("extracts the title from a normalized session.updated event", () => {
    const event = {
      type: "session.updated",
      data: { sessionID: "s1", info: { title: "Fix the reconnect loop" } },
    };
    expect(sessionTitleFromEvent(event as Record<string, unknown>)).toBe(
      "Fix the reconnect loop",
    );
  });

  it("handles the session.next.updated wire format before normalization", () => {
    const event = {
      type: "session.next.updated",
      data: { info: { title: "Refactor auth flow" } },
    };
    expect(sessionTitleFromEvent(event as Record<string, unknown>)).toBe(
      "Refactor auth flow",
    );
  });

  it("falls back to properties for newer OpenCode event payloads", () => {
    const event = {
      type: "session.updated",
      properties: { info: { title: "Use title agent output" } },
    };
    expect(sessionTitleFromEvent(event as Record<string, unknown>)).toBe(
      "Use title agent output",
    );
  });

  it("returns undefined for unrelated events", () => {
    expect(
      sessionTitleFromEvent({
        type: "message.updated",
        data: { info: { title: "ignored" } },
      } as Record<string, unknown>),
    ).toBeUndefined();
  });

  it("returns undefined for OpenCode's default placeholder titles", () => {
    expect(
      sessionTitleFromEvent({
        type: "session.updated",
        data: { info: { title: "New session - 2026-01-01T00:00:00.000Z" } },
      } as Record<string, unknown>),
    ).toBeUndefined();
  });

  it("returns undefined when no title is present", () => {
    expect(
      sessionTitleFromEvent({
        type: "session.updated",
        data: { info: {} },
      } as Record<string, unknown>),
    ).toBeUndefined();
  });
});
