import { z } from "zod";
import { handoffClientStateSchema } from "./shared/handoff";
import { verifyPreview } from "./server/preview-readiness";
import { Hono } from "hono";
import { deploymentStatusSchema, safeParticipantName, safeRoomID } from "./shared/protocol";
import { liveOpenCodeConfigurationError, type WorkerEnv } from "./server/opencode";
import {
  beginGitHubAuthorization,
  clearGitHubSessionCookie,
  completeGitHubAuthorization,
  githubOAuthConfigured,
  readGitHubSession,
} from "./server/github-auth";

interface AppBindings {
  Bindings: WorkerEnv;
}

interface PullRequestInput {
  title?: string;
  body?: string;
}

const handoffInputSchema = z.object({
  participant: z
    .object({ id: z.string(), name: z.string(), role: z.string().optional() })
    .optional(),
  currentOrigin: z.string().optional(),
  clientState: handoffClientStateSchema.optional(),
});

interface RedeemHandoffInput {
  token?: string;
}

interface ActivateRevisionInput {
  revisionID?: string;
  currentOrigin?: string;
}

interface LocalPreviewInput {
  previewURL?: string;
  commitSHA?: string;
}

const deploymentInputSchema = z.object({
  roomID: z.string().optional(),
  commitSHA: z.string().optional(),
  status: deploymentStatusSchema.optional(),
  previewURL: z.string().optional(),
  provider: z.string().optional(),
  deploymentID: z.string().optional(),
  failure: z.string().optional(),
});

const app = new Hono<AppBindings>();

app.get("/api/health", (context) => {
  return context.json({
    ok: true,
    service: "relay-multiplayer-agent",
    opencodeMode: context.env.OPENCODE_MODE,
    opencodeProvider: context.env.OPENCODE_PROVIDER,
    opencodeConfigurationError: liveOpenCodeConfigurationError(context.env),
    sandboxConfigured: railwaySandboxConfigured(context.env),
    githubOAuthConfigured: githubOAuthConfigured(context.env),
  });
});

function railwaySandboxConfigured(env: WorkerEnv): boolean {
  const token = env.RAILWAY_TOKEN ?? env.RAILWAY_API_TOKEN;

  return Boolean(token && env.RAILWAY_ENVIRONMENT_ID);
}

app.get("/api/auth/github/start", async (context) => {
  try {
    return await beginGitHubAuthorization(context.req.raw, context.env);
  } catch (error) {
    return context.json({ error: errorMessage(error) }, 503);
  }
});

app.get("/api/auth/github/callback", async (context) => {
  try {
    return await completeGitHubAuthorization(context.req.raw, context.env);
  } catch (error) {
    return context.json({ error: errorMessage(error) }, 400);
  }
});

app.get("/api/auth/github/session", async (context) => {
  const result = await readGitHubSession(context.req.raw, context.env);

  if (result.setCookie) {
    context.header("Set-Cookie", result.setCookie);
  }

  return context.json({
    configured: githubOAuthConfigured(context.env),
    authenticated: Boolean(result.session),
    user: result.session
      ? { login: result.session.login, avatarURL: result.session.avatarURL }
      : undefined,
  });
});

app.post("/api/auth/github/logout", (context) => {
  context.header("Set-Cookie", clearGitHubSessionCookie());

  return context.json({ ok: true });
});

app.post("/api/rooms/:room/pull-requests", async (context) => {
  if (context.req.header("Origin") !== new URL(context.req.url).origin) {
    return context.json({ error: "Pull request creation requires a same-origin request" }, 403);
  }

  const auth = await readGitHubSession(context.req.raw, context.env);

  if (!auth.session) {
    return context.json({ error: "Connect GitHub before creating a pull request" }, 401);
  }

  if (auth.setCookie) {
    context.header("Set-Cookie", auth.setCookie);
  }

  try {
    const roomID = safeRoomID(context.req.param("room"));

    const input: PullRequestInput = await context.req.json<PullRequestInput>().catch(() => ({}));

    const stub = context.env.AGENT_ROOMS.getByName(roomID);
    await stub.initialize(roomID);

    const pullRequest = await stub.createPullRequest({
      accessToken: auth.session.accessToken,
      login: auth.session.login,
      title: input.title,
      body: input.body,
    });

    return context.json({ pullRequest });
  } catch (error) {
    return context.json({ error: errorMessage(error) }, 400);
  }
});

app.options("/api/rooms/:room/handoffs", (context) =>
  handoffCors(context.req.raw, new Response(null, { status: 204 })),
);

app.post("/api/rooms/:room/handoffs", async (context) => {
  try {
    const roomID = safeRoomID(context.req.param("room"));

    const input = handoffInputSchema.parse(await context.req.json());

    if (!input.participant?.id || !input.participant.name) {
      throw new Error("Participant identity is required");
    }

    const stub = context.env.AGENT_ROOMS.getByName(roomID);
    await stub.initialize(roomID);

    const handoff = await stub.createHandoff({
      participant: {
        id: input.participant.id,
        name: safeParticipantName(input.participant.name),
        role: input.participant.role === "contributor" ? "contributor" : "maintainer",
      },
      clientState: input.clientState,
      currentOrigin:
        input.currentOrigin ?? context.req.header("Origin") ?? new URL(context.req.url).origin,
      controlOrigin: new URL(context.req.url).origin,
    });

    return handoffCors(context.req.raw, context.json(handoff));
  } catch (error) {
    return handoffCors(context.req.raw, context.json({ error: errorMessage(error) }, 400));
  }
});

app.options("/api/rooms/:room/handoffs/redeem", (context) =>
  handoffCors(context.req.raw, new Response(null, { status: 204 })),
);

app.post("/api/rooms/:room/handoffs/redeem", async (context) => {
  try {
    const roomID = safeRoomID(context.req.param("room"));
    const input = await context.req.json<RedeemHandoffInput>();

    if (!input.token) {
      throw new Error("Room handoff ticket is required");
    }

    const stub = context.env.AGENT_ROOMS.getByName(roomID);
    await stub.initialize(roomID);

    const result = await stub.redeemHandoff({
      token: input.token,
      targetOrigin: context.req.header("Origin") ?? new URL(context.req.url).origin,
    });

    return handoffCors(context.req.raw, context.json(result));
  } catch (error) {
    return handoffCors(context.req.raw, context.json({ error: errorMessage(error) }, 400));
  }
});

app.options("/api/rooms/:room/revisions/activate", (context) =>
  handoffCors(context.req.raw, new Response(null, { status: 204 })),
);

app.post("/api/rooms/:room/revisions/activate", async (context) => {
  try {
    const roomID = safeRoomID(context.req.param("room"));

    const input = await context.req.json<ActivateRevisionInput>();

    if (!input.revisionID) {
      throw new Error("Room revision is required");
    }

    const stub = context.env.AGENT_ROOMS.getByName(roomID);
    await stub.initialize(roomID);

    const revision = await stub.activateRevision({
      revisionID: input.revisionID,
      currentOrigin:
        input.currentOrigin ?? context.req.header("Origin") ?? new URL(context.req.url).origin,
    });

    return handoffCors(context.req.raw, context.json({ revision }));
  } catch (error) {
    return handoffCors(context.req.raw, context.json({ error: errorMessage(error) }, 400));
  }
});

app.post("/api/rooms/:room/local-preview", async (context) => {
  const hostname = new URL(context.req.url).hostname;
  const localRequest = hostname === "127.0.0.1" || hostname === "localhost";

  if (context.env.OPENCODE_MODE !== "simulation" && !localRequest) {
    return context.json({ error: "Local previews are disabled" }, 404);
  }

  try {
    const roomID = safeRoomID(context.req.param("room"));

    const input = await context.req.json<LocalPreviewInput>();

    if (!input.previewURL) {
      throw new Error("Preview URL is required");
    }

    await verifyPreview(input.previewURL, input.commitSHA);
    const stub = context.env.AGENT_ROOMS.getByName(roomID);
    await stub.initialize(roomID);

    return context.json({
      revision: await stub.createLocalPreview({
        previewURL: input.previewURL,
        commitSHA: input.commitSHA,
      }),
    });
  } catch (error) {
    return context.json({ error: errorMessage(error) }, 400);
  }
});

app.post("/api/deployments", async (context) => {
  const expected = context.env.RELAY_DEPLOYMENT_WEBHOOK_SECRET;

  if (!expected || context.req.header("Authorization") !== `Bearer ${expected}`) {
    return context.json({ error: "Unauthorized deployment callback" }, 401);
  }

  try {
    const input = deploymentInputSchema.parse(await context.req.json());

    if (!input.roomID || !input.commitSHA || !input.status) {
      throw new Error("Room, commit, and deployment status are required");
    }

    if (input.status === "ready") {
      if (!input.previewURL) {
        throw new Error("A ready deployment requires a preview URL");
      }

      await verifyPreview(input.previewURL, input.commitSHA);
    }

    const roomID = safeRoomID(input.roomID);
    const stub = context.env.AGENT_ROOMS.getByName(roomID);
    await stub.initialize(roomID);

    return context.json({
      revision: await stub.recordDeployment({
        commitSHA: input.commitSHA,
        status: input.status,
        previewURL: input.previewURL,
        provider: input.provider,
        deploymentID: input.deploymentID,
        failure: input.failure,
      }),
    });
  } catch (error) {
    return context.json({ error: errorMessage(error) }, 400);
  }
});

app.all("/api/rooms/:room/*", async (context) => {
  const roomID = safeRoomID(context.req.param("room"));
  const url = new URL(context.req.url);

  if (url.searchParams.has("name")) {
    url.searchParams.set("name", safeParticipantName(url.searchParams.get("name")));
  }

  const stub = context.env.AGENT_ROOMS.getByName(roomID);
  await stub.initialize(roomID);

  return stub.fetch(new Request(url, context.req.raw));
});

app.all("*", (context) => context.env.ASSETS.fetch(context.req.raw));

export default app;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Request failed";
}

function handoffCors(request: Request, response: Response): Response {
  const origin = request.headers.get("Origin");

  if (!origin) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Vary", "Origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
