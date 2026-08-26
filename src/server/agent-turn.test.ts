import { describe, expect, it } from "vitest";
import { completedTurnStatus } from "./agent-turn";

describe("completedTurnStatus", () => {
  it("ignores a stale turn finishing after a newer turn starts", () => {
    expect(completedTurnStatus(2, 1, "idle")).toBeUndefined();
  });

  it("publishes the terminal status of the newest turn", () => {
    expect(completedTurnStatus(2, 2, "idle")).toBe("idle");
    expect(completedTurnStatus(3, 3, "error")).toBe("error");
  });
});
