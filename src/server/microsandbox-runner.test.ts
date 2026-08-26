import { describe, expect, it, vi } from "vitest";
import {
  MicrosandboxRunnerClient,
  parseNativeRunnerEvent,
} from "./microsandbox-runner";

const request = {
  roomID: "room",
  repository: "owner/repo",
  commitSHA: "a".repeat(40),
  changes: [],
  prompt: "Build it",
  delivery: "steer" as const,
  model: "opencode/hy3-free",
};

describe("MicrosandboxRunnerClient", () => {
  it("streams native OpenCode events and durable workspace changes", async () => {
    const raw = {
      id: "evt_1",
      type: "session.execution.succeeded",
      data: { sessionID: "ses_1" },
    };
    const body = [
      { type: "session", sessionID: "ses_1" },
      { type: "opencode", cursor: "12", event: raw },
      { type: "changes", changes: [{ path: "src/a.ts", content: "x\n" }] },
      { type: "result", status: "succeeded", durationMs: 10 },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    const client = new MicrosandboxRunnerClient(
      {
        MICROSANDBOX_RUNNER_URL: "http://127.0.0.1:7777",
        MICROSANDBOX_RUNNER_TOKEN: "x".repeat(32),
      },
      fetcher,
    );
    const events: string[] = [];
    await expect(
      client.turn(request, (event) => {
        events.push(event.type);
      }),
    ).resolves.toEqual({
      sessionID: "ses_1",
      status: "succeeded",
      changes: [{ path: "src/a.ts", content: "x\n" }],
      cursor: "12",
    });
    expect(events).toEqual(["session", "opencode", "changes", "result"]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("invokes injected fetch with the Workers global receiver", async () => {
    let receiver: unknown;
    const fetcher = function (this: unknown) {
      receiver = this;
      return Promise.resolve(
        new Response(
          [
            { type: "session", sessionID: "ses_1" },
            { type: "changes", changes: [] },
            { type: "result", status: "succeeded", durationMs: 1 },
          ]
            .map((event) => JSON.stringify(event))
            .join("\n"),
        ),
      );
    } as typeof fetch;
    const client = new MicrosandboxRunnerClient(
      {
        MICROSANDBOX_RUNNER_URL: "https://runner.example",
        MICROSANDBOX_RUNNER_TOKEN: "secret",
      },
      fetcher,
    );
    await client.turn(request);
    expect(receiver).toBe(globalThis);
  });

  it("sends interrupts through a separate bounded endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null));
    const client = new MicrosandboxRunnerClient(
      {
        MICROSANDBOX_RUNNER_URL: "http://localhost:7777",
        MICROSANDBOX_RUNNER_TOKEN: "x".repeat(32),
      },
      fetcher,
    );
    await client.interrupt("room", "ses_1");
    expect(fetcher.mock.calls[0]?.[0].toString()).toContain(
      "/v1/opencode/interrupt",
    );
  });

  it("rejects malformed streamed events", () => {
    expect(() => parseNativeRunnerEvent("not json")).toThrow(
      "invalid streamed output",
    );
  });
});
