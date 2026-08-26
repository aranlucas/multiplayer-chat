import { Hono } from "hono";
import { safeParticipantName, safeRoomID } from "./shared/protocol";
import { AgentRoom } from "./server/agent-room";
import type { WorkerEnv } from "./server/opencode";
import {
  beginGitHubAuthorization,
  clearGitHubSessionCookie,
  completeGitHubAuthorization,
  githubOAuthConfigured,
  readGitHubSession,
} from "./server/github-auth";

export { Sandbox } from "@cloudflare/sandbox";

const app = new Hono<{ Bindings: WorkerEnv }>();

app.get("/api/health", async (context) => {
  const sandboxExecutor = context.env.MICROSANDBOX_RUNNER_URL && context.env.MICROSANDBOX_RUNNER_TOKEN
    ? "microsandbox"
    : context.env.Sandbox
      ? "cloudflare-sandbox"
      : "workers-preflight";
  let sandboxReachable = false;
  if (sandboxExecutor === "microsandbox") {
    sandboxReachable = await fetch(new URL("/health", context.env.MICROSANDBOX_RUNNER_URL), {
      headers: { Authorization: `Bearer ${context.env.MICROSANDBOX_RUNNER_TOKEN}` },
      signal: AbortSignal.timeout(5_000),
    }).then((response) => response.ok).catch(() => false);
  }
  return context.json({
    ok: true,
    service: "relay-multiplayer-agent",
    opencodeMode: context.env.OPENCODE_MODE,
    opencodeProvider: context.env.OPENCODE_PROVIDER,
    sandboxExecutor,
    sandboxReachable,
    githubOAuthConfigured: githubOAuthConfigured(context.env),
  });
});

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
  if (result.setCookie) context.header("Set-Cookie", result.setCookie);
  return context.json({
    configured: githubOAuthConfigured(context.env),
    authenticated: Boolean(result.session),
    user: result.session ? { login: result.session.login, avatarURL: result.session.avatarURL } : undefined,
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
  if (!auth.session) return context.json({ error: "Connect GitHub before creating a pull request" }, 401);
  if (auth.setCookie) context.header("Set-Cookie", auth.setCookie);
  try {
    const roomID = safeRoomID(context.req.param("room"));
    const input: { title?: string; body?: string } = await context.req
      .json<{ title?: string; body?: string }>()
      .catch(() => ({}));
    const stub = context.env.AGENT_ROOMS.getByName(roomID) as DurableObjectStub<AgentRoom>;
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

app.all("/api/rooms/:room/*", async (context) => {
  const roomID = safeRoomID(context.req.param("room"));
  const url = new URL(context.req.url);
  if (url.searchParams.has("name")) url.searchParams.set("name", safeParticipantName(url.searchParams.get("name")));
  const stub = context.env.AGENT_ROOMS.getByName(roomID) as DurableObjectStub<AgentRoom>;
  await stub.initialize(roomID);
  return stub.fetch(new Request(url, context.req.raw));
});

app.all("*", (context) => context.env.ASSETS.fetch(context.req.raw));

export { AgentRoom };
export default app;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}
