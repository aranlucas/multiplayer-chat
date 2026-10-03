import { z } from "zod";
import { DurableObject } from "cloudflare:workers";
import { Plugin } from "@opencode/plugin";
import { OpenCodeWorkerd } from "@opencode/sdk/workerd";
import { EmbeddedOpenCodeRunner, openCodeHost } from "../embedded-opencode";
import { openCodeConfiguration } from "../opencode";

// All SDK operations in this fixture are in-process. Provider requests are captured
// by the plugin below; this final guard prevents accidental external inference.
globalThis.fetch = async () => {
  throw new Error("External network disabled in SDK regression worker");
};

interface TestEnv {
  HOSTS: DurableObjectNamespace<OpenCodeTestHost>;
}

let pluginSetups = 0;

const blockedSessions = new Set<string>();

const gatewaySessions = new Set<string>();

const gatewayRequests = new Map<string, { url: string; headers: Record<string, string> }>();

const plugin = Plugin.define({
  id: "relay.sdk-regression",
  async setup(ctx) {
    await ctx.agent.transform((agents) => {
      agents.update("build", (agent) => {
        agent.description = "Relay SDK regression";
      });
    });
    await ctx.session.hook("prompt", (event) => {
      if (gatewaySessions.has(event.sessionID)) {
        return;
      }

      // Verify plugin activation without sending a model request.
      blockedSessions.add(event.sessionID);
      throw new Error("Prompt stopped by the regression test plugin");
    });
    await ctx.session.hook("http.request", (event) => {
      if (!gatewaySessions.has(event.sessionID)) {
        throw new Error("Unexpected model request in the SDK regression fixture");
      }

      if (event.kind === "primary") {
        gatewayRequests.set(event.sessionID, {
          url: event.request.url,
          headers: Object.fromEntries(event.request.headers),
        });
      }

      // Capture the fully constructed SDK request before any external inference.
      throw new Error("Gateway request captured by the regression test plugin");
    });
    pluginSetups += 1;
  },
});

export class OpenCodeTestHost extends DurableObject<TestEnv> {
  private readonly host: Promise<OpenCodeWorkerd.Interface>;
  private readonly runner: EmbeddedOpenCodeRunner;

  constructor(ctx: DurableObjectState, env: TestEnv) {
    super(ctx, env);
    this.host = ctx.blockConcurrencyWhile(() =>
      OpenCodeWorkerd.create({
        storage: ctx.storage,
        config: openCodeConfiguration({
          OPENCODE_PROVIDER: "openrouter",
          OPENCODE_MODEL: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
          OPENROUTER_API_KEY: "openrouter-test-key",
          CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
          CLOUDFLARE_AI_GATEWAY_ID: "relay",
          CLOUDFLARE_AI_GATEWAY_TOKEN: "gateway-run-token",
        }),
        models: { fetch: false },
        plugins: [plugin],
      }),
    );
    this.runner = new EmbeddedOpenCodeRunner(
      this.host.then(openCodeHost),
      {
        ensureReady: async () => {
          throw new Error("Form operations must not initialize the workspace");
        },
        syncSandboxChanges: async () => [],
      },
      { killActive: async () => {} },
    );
  }

  async fetch(request: Request): Promise<Response> {
    const host = await this.host;
    const path = new URL(request.url).pathname;

    const session = await host.sessions.create({
      model: { providerID: "openrouter", id: "openai/gpt-4.1" },
      location: { directory: "/workspace/repository" },
    });

    const form = await host.sessions.form.create({
      sessionID: session.id,
      title: "Choose a build target",
      fields: [{ key: "target", type: "string", required: true }],
    });

    if (path === "/gateway") {
      gatewaySessions.add(session.id);

      try {
        await host.sessions.prompt({ sessionID: session.id, text: "Verify gateway routing" });
        await host.sessions.wait(
          { sessionID: session.id },
          { signal: AbortSignal.timeout(10_000) },
        );
        const captured = gatewayRequests.get(session.id);

        if (!captured) {
          throw new Error("The SDK did not construct a gateway request");
        }

        return Response.json(captured);
      } finally {
        gatewaySessions.delete(session.id);
        gatewayRequests.delete(session.id);
      }
    } else if (path === "/bootstrap") {
      try {
        await host.sessions.prompt(
          { sessionID: session.id, text: "Verify the bundled plugin" },
          {
            signal: AbortSignal.timeout(10_000),
          },
        );
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error;
        }

        return Response.json({
          pluginLoaded: pluginSetups > 0,
          promptBlocked: blockedSessions.has(session.id),
        });
      }

      throw new Error("The regression plugin did not block prompt admission");
    } else if (path === "/answer") {
      await this.runner.replyToForm(session.id, form.id, { target: "production" });
    } else if (path === "/cancel") {
      await this.runner.cancelForm(session.id, form.id);
    } else if (path === "/concurrent") {
      const outcomes = await Promise.allSettled([
        this.runner.replyToForm(session.id, form.id, { target: "production" }),
        this.runner.replyToForm(session.id, form.id, { target: "preview" }),
      ]);

      return Response.json({
        outcomes: outcomes.map((outcome) =>
          outcome.status === "fulfilled" ? "fulfilled" : errorTag(outcome.reason),
        ),
        form: await host.sessions.form.get({ sessionID: session.id, formID: form.id }),
      });
    } else if (path === "/invalid-answer") {
      try {
        await this.runner.replyToForm(session.id, form.id, {});
      } catch (error) {
        return Response.json({
          error: errorTag(error),
          form: await host.sessions.form.get({ sessionID: session.id, formID: form.id }),
        });
      }

      throw new Error("An invalid answer was accepted");
    } else {
      throw new Error(`Unknown test operation: ${path}`);
    }

    return Response.json(await host.sessions.form.get({ sessionID: session.id, formID: form.id }));
  }
}

function errorTag(cause: unknown): string {
  const error = z.object({ _tag: z.string() }).safeParse(cause);

  if (error.success) {
    return error.data._tag;
  }

  throw new Error("Unexpected SDK error", { cause });
}

export default {
  fetch(request: Request, env: TestEnv): Promise<Response> {
    return env.HOSTS.getByName("sdk-regression").fetch(request);
  },
};
