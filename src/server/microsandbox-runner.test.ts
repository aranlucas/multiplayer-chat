import { describe, expect, it, vi } from "vitest";
import {
  MicrosandboxRunnerClient,
  parseRunnerEvent,
} from "./microsandbox-runner";

describe("MicrosandboxRunnerClient", () => {
  it("invokes injected fetch with the global receiver required by Workers", async () => {
    let receiver: unknown;
    const fetcher = function (this: unknown) {
      receiver = this;
      return Promise.resolve(
        new Response(
          `${JSON.stringify({ type: "changes", changes: [] })}\n${JSON.stringify({ type: "result", exitCode: 0, durationMs: 1 })}\n`,
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

    await client.execute({
      roomID: "room",
      repository: "owner/repo",
      commitSHA: "a".repeat(40),
      changes: [],
      command: "true",
    });

    expect(receiver).toBe(globalThis);
  });

  it("streams events and returns combined command output", async () => {
    const body = [
      { type: "status", message: "Booting" },
      { type: "stdout", data: "tests " },
      { type: "stderr", data: "running\n" },
      {
        type: "changes",
        changes: [{ path: "src/index.ts", content: "updated\n" }],
      },
      { type: "result", exitCode: 0, durationMs: 25 },
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
    const execution = await client.execute(
      {
        roomID: "room",
        repository: "owner/repo",
        commitSHA: "a".repeat(40),
        changes: [],
        command: "pnpm test",
      },
      (event) => {
        events.push(event.type);
      },
    );
    expect(execution).toEqual({
      output: "tests running",
      exitCode: 0,
      changes: [{ path: "src/index.ts", content: "updated\n" }],
    });
    expect(events).toEqual([
      "status",
      "stdout",
      "stderr",
      "changes",
      "result",
    ]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("returns non-zero exits with their durable mutations", async () => {
    const body = `${JSON.stringify({ type: "stderr", data: "failed\n" })}\n${JSON.stringify({ type: "changes", changes: [{ path: "removed.ts", content: null }] })}\n${JSON.stringify({ type: "result", exitCode: 2, durationMs: 8 })}\n`;
    const client = new MicrosandboxRunnerClient(
      {
        MICROSANDBOX_RUNNER_URL: "http://localhost:7777",
        MICROSANDBOX_RUNNER_TOKEN: "x".repeat(32),
      },
      vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
    );
    await expect(
      client.execute({
        roomID: "room",
        repository: "owner/repo",
        commitSHA: "a".repeat(40),
        changes: [],
        command: "false",
      }),
    ).resolves.toEqual({
      output: "failed",
      exitCode: 2,
      changes: [{ path: "removed.ts", content: null }],
    });
  });

  it("rejects malformed streamed events", () => {
    expect(() => parseRunnerEvent("not json")).toThrow(
      "invalid streamed output",
    );
  });
});
