import { parseJsonRecord, type JsonRecord } from "@/shared/json-value";
import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

describe("installed OpenCode Workerd SDK", () => {
  beforeAll(async () => {
    // Compile the SDK's module graph before timing session operations. The
    // fixture still initializes its real host lazily on the first request.
    await import("./fixtures/opencode-worker");
  }, 30_000);

  it("initializes the retained host and bundled plugin for concurrent sessions", async () => {
    const sessions = await Promise.all([run("/bootstrap"), run("/bootstrap")]);

    for (const session of sessions) {
      expect(session).toEqual({ pluginLoaded: true, promptBlocked: true });
    }
  }, 20_000);

  it("sends concurrent model requests to AI Gateway with distinct provider and gateway credentials", async () => {
    const requests = await Promise.all([run("/gateway"), run("/gateway")]);

    for (const request of requests) {
      expect(request).toMatchObject({
        url: "https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/relay/openrouter/chat/completions",
        headers: {
          authorization: "Bearer openrouter-test-key",
          "cf-aig-authorization": "Bearer gateway-run-token",
          "cf-aig-collect-log-payload": "false",
          "cf-aig-skip-cache": "true",
          "cf-aig-no-wholesale": "true",
        },
      });
    }
  }, 20_000);

  it("persists an answer through the runner's session form API", async () => {
    expect(await run("/answer")).toMatchObject({
      state: { status: "answered", answer: { target: "production" } },
    });
  });

  it("persists cancellation through the runner's session form API", async () => {
    expect(await run("/cancel")).toMatchObject({ state: { status: "cancelled" } });
  });

  it("surfaces invalid answers and leaves the form pending", async () => {
    expect(await run("/invalid-answer")).toMatchObject({
      error: "FormInvalidAnswerError",
      form: { state: { status: "pending" } },
    });
  });

  it("settles one of two concurrent replies and surfaces the conflict", async () => {
    expect(await run("/concurrent")).toMatchObject({
      outcomes: ["fulfilled", "FormAlreadySettledError"],
      form: { state: { status: "answered", answer: { target: "production" } } },
    });
  });
});

async function run(path: string): Promise<JsonRecord> {
  const response = await exports.default.fetch(`http://localhost${path}`);
  expect(response.status).toBe(200);

  return parseJsonRecord(await response.json());
}
