import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRANCH,
  DEFAULT_REPOSITORY,
  parseClientMessage,
  queuedPrompts,
  safeParticipantName,
  safeRoomID,
} from "./protocol";

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
    expect(
      parseClientMessage({
        type: "prompt",
        text: " investigate ",
        delivery: "steer",
      }),
    ).toEqual({
      type: "prompt",
      text: "investigate",
      delivery: "steer",
      requestID: undefined,
    });
    expect(
      parseClientMessage({
        type: "prompt",
        text: "follow up",
        delivery: "queue",
      }),
    ).toMatchObject({
      delivery: "queue",
    });
  });

  it("keeps only pending prompts in the queue", () => {
    const actor = {
      id: "participant-1",
      name: "Maya",
      role: "maintainer" as const,
      color: "#fff",
    };
    const prompt = (id: string, queueStatus?: string) => ({
      seq: Number(id),
      id,
      kind: "prompt" as const,
      createdAt: Number(id),
      actor,
      payload: { text: `Prompt ${id}`, delivery: "queue", queueStatus },
    });

    expect(queuedPrompts([prompt("1", "consumed"), prompt("2", "pending"), prompt("3")])).toEqual([
      expect.objectContaining({ eventID: "2", text: "Prompt 2" }),
    ]);
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

  it("accepts trimmed room titles", () => {
    expect(
      parseClientMessage({
        type: "room.rename",
        title: " Fix the reconnect loop ",
        requestID: "rename-1",
      }),
    ).toEqual({
      type: "room.rename",
      title: "Fix the reconnect loop",
      requestID: "rename-1",
    });
  });

  it("accepts models selected from OpenCode", () => {
    expect(
      parseClientMessage({
        type: "room.model.configure",
        model: " opencode/mimo-v2.5-free ",
        requestID: "model-1",
      }),
    ).toEqual({
      type: "room.model.configure",
      model: "opencode/mimo-v2.5-free",
      requestID: "model-1",
    });
  });

  it("accepts structured implementation brief updates", () => {
    expect(
      parseClientMessage({
        type: "brief.update",
        objective: " Ship reconnect handling ",
        constraints: [" Keep the protocol compatible "],
        validation: [" Reconnect test passes "],
        requestID: "brief-1",
      }),
    ).toEqual({
      type: "brief.update",
      objective: "Ship reconnect handling",
      constraints: ["Keep the protocol compatible"],
      validation: ["Reconnect test passes"],
      requestID: "brief-1",
    });
  });

  it("accepts attributed decisions linked to timeline events", () => {
    expect(
      parseClientMessage({
        type: "decision.create",
        text: " Use one Durable Object per room ",
        rationale: " Preserve ordered room state ",
        sourceEventID: "event-12",
      }),
    ).toEqual({
      type: "decision.create",
      text: "Use one Durable Object per room",
      rationale: "Preserve ordered room state",
      sourceEventID: "event-12",
      requestID: undefined,
    });
  });

  it("accepts implementation brief review actions", () => {
    expect(
      parseClientMessage({
        type: "brief.review.start",
        requestID: "review-1",
      }),
    ).toEqual({ type: "brief.review.start", requestID: "review-1" });
    expect(
      parseClientMessage({
        type: "brief.review.comment",
        text: " Clarify the rollback check ",
      }),
    ).toEqual({
      type: "brief.review.comment",
      text: "Clarify the rollback check",
      requestID: undefined,
    });
    expect(
      parseClientMessage({
        type: "brief.review.resolve",
        outcome: "approved",
        comment: " Ready to build ",
      }),
    ).toEqual({
      type: "brief.review.resolve",
      outcome: "approved",
      comment: "Ready to build",
      requestID: undefined,
    });
  });

  it("accepts answers to an active OpenCode question", () => {
    expect(
      parseClientMessage({
        type: "question.reply",
        sessionID: "ses_1",
        formID: "frm_1",
        answer: {
          q0: ["Add contributing guidelines", "Document API/protocol"],
        },
        requestID: "answer-1",
      }),
    ).toEqual({
      type: "question.reply",
      sessionID: "ses_1",
      formID: "frm_1",
      answer: {
        q0: ["Add contributing guidelines", "Document API/protocol"],
      },
      requestID: "answer-1",
    });
  });

  it("rejects malformed or overlong messages", () => {
    expect(() => parseClientMessage({ type: "prompt", text: "", delivery: "steer" })).toThrow();
    expect(() =>
      parseClientMessage({
        type: "prompt",
        text: "x".repeat(8_001),
        delivery: "steer",
      }),
    ).toThrow();
    expect(() =>
      parseClientMessage({
        type: "permission.reply",
        requestID: "p1",
        reply: "maybe",
      }),
    ).toThrow();
    expect(() => parseClientMessage({ type: "room.rename", title: "   " })).toThrow();
    expect(() => parseClientMessage({ type: "room.rename", title: "x".repeat(101) })).toThrow();
    expect(() => parseClientMessage({ type: "room.model.configure", model: "hy3-free" })).toThrow();
    expect(() =>
      parseClientMessage({
        type: "question.reply",
        sessionID: "ses_1",
        formID: "frm_1",
        answer: { arbitrary: "nope" },
      }),
    ).toThrow("Invalid question field");
    expect(() =>
      parseClientMessage({
        type: "brief.update",
        objective: "valid",
        constraints: "not a list",
        validation: [],
      }),
    ).toThrow("Brief constraints are invalid");
    expect(() => parseClientMessage({ type: "decision.create", text: "   " })).toThrow(
      "decision must be between",
    );
    expect(() =>
      parseClientMessage({
        type: "brief.review.comment",
        text: "   ",
      }),
    ).toThrow("review comment must be between");
    expect(() =>
      parseClientMessage({
        type: "brief.review.resolve",
        outcome: "changes_requested",
      }),
    ).toThrow("Describe the changes");
    expect(() =>
      parseClientMessage({
        type: "brief.review.resolve",
        outcome: "maybe",
      }),
    ).toThrow("valid review outcome");
  });
});
