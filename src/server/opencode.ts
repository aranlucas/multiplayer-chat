import type { Sandbox } from "@cloudflare/sandbox";
import type { GitHubOAuthEnv } from "./github-auth";
import type { MicrosandboxRunnerEnv } from "./microsandbox-runner";

export interface WorkerEnv extends GitHubOAuthEnv, MicrosandboxRunnerEnv {
  AGENT_ROOMS: DurableObjectNamespace;
  Sandbox?: DurableObjectNamespace<Sandbox>;
  ASSETS: Fetcher;
  OPENCODE_MODE: "simulation" | "live";
  OPENCODE_PROVIDER: "opencode-zen" | "cloudflare-workers-ai";
  OPENCODE_ZEN_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN?: string;
  OPENCODE_MODEL: string;
  RELAY_DEPLOYMENT_WEBHOOK_SECRET?: string;
}

export function hasLiveOpenCode(env: WorkerEnv) {
  return Boolean(
    env.OPENCODE_MODE === "live" &&
      env.MICROSANDBOX_RUNNER_URL &&
      env.MICROSANDBOX_RUNNER_TOKEN,
  );
}
