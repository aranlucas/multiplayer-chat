import { describe, expect, it } from "vitest";
import { DEFAULT_BRANCH, DEFAULT_REPOSITORY, parseClientMessage, safeParticipantName, safeRoomID } from "./protocol";

describe("room protocol", () => {
  it("defaults new rooms to the Relay source repository", () => {
    expect(DEFAULT_REPOSITORY).toBe("aranlucas/multiplayer-chat");
    expect(DEFAULT_BRANCH).toBe("main");
  });

  it("normalizes room and participant identity", () => {
    expect(safeRoomID("Reconnect Loop! / 2026")).toBe("reconnect-loop-2026");
    expect(safeParticipantName("  <Maya>  ")).toBe("Maya");
  });

  it("accepts steer and queued prompts", () => {
    expect(parseClientMessage({ type: "prompt", text: " investigate ", delivery: "steer" })).toEqual({
      type: "prompt",
      text: "investigate",
      delivery: "steer",
      requestID: undefined,
    });
    expect(parseClientMessage({ type: "prompt", text: "follow up", delivery: "queue" })).toMatchObject({
      delivery: "queue",
    });
  });

  it("accepts repository configuration messages", () => {
    expect(
      parseClientMessage({
        type: "room.configure",
        repository: " cloudflare/workers-chat-demo ",
        branch: " main ",
        requestID: "config-1",
      }),
    ).toEqual({
      type: "room.configure",
      repository: "cloudflare/workers-chat-demo",
      branch: "main",
      requestID: "config-1",
    });
  });

  it("rejects malformed or overlong messages", () => {
    expect(() => parseClientMessage({ type: "prompt", text: "", delivery: "steer" })).toThrow();
    expect(() => parseClientMessage({ type: "prompt", text: "x".repeat(8_001), delivery: "steer" })).toThrow();
    expect(() => parseClientMessage({ type: "permission.reply", requestID: "p1", reply: "maybe" })).toThrow();
  });
});
