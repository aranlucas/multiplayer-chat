import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
vi.mock("@opencode-ai/sdk/workerd", () => ({ OpenCodeWorkerd: class {} }));

import { AgentRoom } from "./agent-room";

afterEach(() => vi.unstubAllGlobals());

describe("deployment readiness", () => {
  it.each(["abc", "wrong-commit"])(
    "recovers a saved preview only for its published SHA (%s)",
    async (commitSHA) => {
      const revision = {
        commitSHA: "abc",
        status: "waiting",
        previewURL: "https://preview.example",
        createdAt: Date.now(),
      };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({ ready: true, commitSHA, roomProtocol: 1 })),
      );
      const recordDeployment = vi.fn();
      const room = Object.assign(Object.create(AgentRoom.prototype), {
        getRoomOrNull: () => ({ pullRequestHeadSHA: "abc", latestRevision: revision }),
        githubCredential: () => undefined,
        recordDeployment,
      });
      await room.alarm();
      if (commitSHA === "abc") {
        expect(recordDeployment).toHaveBeenCalledWith(
          expect.objectContaining({ status: "ready", commitSHA: "abc" }),
        );
      } else {
        expect(recordDeployment).not.toHaveBeenCalled();
      }
    },
  );
  it.each(["waiting", "building", "failed"] as const)(
    "does not let a stale %s observation overwrite a ready callback",
    async (status) => {
      const ready = {
        id: "revision",
        commitSHA: "abc",
        status: "ready",
        previewURL: "https://preview.example",
      };
      const exec = vi.fn();
      const room = Object.assign(Object.create(AgentRoom.prototype), {
        revisionForCommit: () => ready,
        ctx: { storage: { sql: { exec } } },
      });
      expect(await room.recordDeployment({ commitSHA: "abc", status })).toBe(ready);
      expect(exec).not.toHaveBeenCalled();
    },
  );
});
