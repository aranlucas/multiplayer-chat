import { parseJsonRecord, type JsonRecord } from "../shared/json-value";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_dev, type Unstable_DevWorker } from "wrangler";

describe("installed OpenCode Workerd SDK", () => {
  let worker: Unstable_DevWorker;

  beforeAll(async () => {
    worker = await unstable_dev(
      fileURLToPath(new URL("./fixtures/opencode-worker.ts", import.meta.url)),
      {
        config: fileURLToPath(new URL("./fixtures/wrangler.jsonc", import.meta.url)),
        local: true,
        port: 0,
        inspectorPort: 0,
        persist: false,
        logLevel: "error",
        experimental: {
          disableExperimentalWarning: true,
          disableDevRegistry: true,
          watch: false,
        },
      },
    );
  }, 30_000);

  afterAll(async () => {
    await worker?.stop();
  });

  async function run(path: string): Promise<JsonRecord> {
    const response = await worker.fetch(`http://localhost${path}`);
    expect(response.status).toBe(200);

    return parseJsonRecord(await response.json());
  }

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
