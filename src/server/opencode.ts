import type { Plugin } from "@opencode-ai/plugin/promise/plugin";
import type { OpenCodeWorkerd } from "@opencode-ai/sdk/workerd";
import type { Sandbox } from "@cloudflare/sandbox";
import type { RunnerEvent } from "./microsandbox-runner";
import type { RepositoryWorkspace } from "./workspace";
import type { GitHubOAuthEnv } from "./github-auth";

export interface WorkerEnv extends GitHubOAuthEnv {
  AGENT_ROOMS: DurableObjectNamespace;
  Sandbox?: DurableObjectNamespace<Sandbox>;
  ASSETS: Fetcher;
  OPENCODE_MODE: "simulation" | "live";
  OPENCODE_PROVIDER: "opencode-zen" | "cloudflare-workers-ai";
  OPENCODE_ZEN_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN?: string;
  OPENCODE_MODEL: string;
  MICROSANDBOX_RUNNER_URL?: string;
  MICROSANDBOX_RUNNER_TOKEN?: string;
}

export function relayPlugin(workspace: RepositoryWorkspace): Plugin {
  return {
    id: "relay.collaboration",
    async setup(ctx) {
      await ctx.agent.transform((agents) => {
        agents.update("build", (agent) => {
          agent.description =
            "Investigates and modifies the room's real, commit-pinned GitHub workspace. Use Relay tools for status, search, file reads, diffs, tests, and patches. relay.read_file adds a line-number gutter for display; never include that gutter in patch context. relay.apply_patch accepts only a standard unified diff with ---/+++/numeric @@ headers, never the *** Begin Patch format. Explain evidence from tool output. This room runs in dangerous always-allow mode, so tools do not pause for approval.";
        });
      });

      await ctx.permission.hook("evaluate", (event) => {
        event.effect = "allow";
      });

      await ctx.tool.transform((tools) => {
        tools.add({
          name: "repo_status",
          description:
            "Return the selected GitHub repository, branch, and pinned commit for this room.",
          input: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          options: { namespace: "relay", codemode: true },
          async execute(_input, tool) {
            await tool.progress({
              status: "Preparing the commit-pinned workspace",
            });
            const info = await workspace.ensureReady();
            return {
              content: `repository: ${info.repository}\nbranch: ${info.branch}\ncommit: ${info.commitSHA}\nworkspace: ${info.directory}`,
            };
          },
        });

        tools.add({
          name: "repo_search",
          description:
            "Search the connected repository for a string or symbol.",
          input: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false,
          },
          options: { namespace: "relay", codemode: true },
          async execute(input, tool) {
            const query = String((input as { query: string }).query);
            await tool.progress({ status: `Searching for ${query}` });
            return { content: await workspace.search(query) };
          },
        });

        tools.add({
          name: "read_file",
          description:
            "Read a UTF-8 file from the connected repository with an `N │ ` line-number gutter for display. Omit the gutter when constructing patches.",
          input: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          },
          options: { namespace: "relay", codemode: true },
          async execute(input, tool) {
            const path = String((input as { path: string }).path);
            await tool.progress({ status: `Reading ${path}` });
            return { content: await workspace.readFile(path) };
          },
        });

        tools.add({
          name: "git_diff",
          description:
            "Read the current uncommitted diff in the shared repository workspace.",
          input: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          options: { namespace: "relay", codemode: true },
          async execute(_input, tool) {
            await tool.progress({ status: "Reading the workspace diff" });
            return { content: await workspace.diff() };
          },
        });

        tools.add({
          name: "run_tests",
          description:
            "Run the repository test target and return the terminal transcript.",
          input: {
            type: "object",
            properties: {
              target: {
                type: "string",
                enum: ["auto", "test", "typecheck", "build"],
              },
            },
            required: ["target"],
            additionalProperties: false,
          },
          options: { namespace: "relay", codemode: true },
          async execute(input, tool) {
            const target = String((input as { target: string }).target) as
              "auto" | "test" | "typecheck" | "build";
            await tool.progress({ status: `Running ${target}` });
            return {
              content: await workspace.runTests(target, (event) =>
                tool.progress({ status: runnerProgress(event) }),
              ),
            };
          },
        });

        tools.add({
          name: "run_command",
          description:
            "Run an arbitrary shell command in the commit-pinned Microsandbox workspace and stream its terminal output.",
          input: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
            additionalProperties: false,
          },
          options: { namespace: "relay", permission: "bash", codemode: true },
          async execute(input, tool) {
            const command = String((input as { command: string }).command);
            await tool.progress({ status: `$ ${command.slice(0, 160)}` });
            return {
              content: await workspace.runCommand(command, (event) =>
                tool.progress({ status: runnerProgress(event) }),
              ),
            };
          },
        });

        tools.add({
          name: "apply_patch",
          description:
            "Apply a standard unified diff to the shared repository workspace immediately in dangerous always-allow mode. The patch must use `--- a/path`, `+++ b/path`, and numeric `@@ -oldStart,oldCount +newStart,newCount @@` headers. Do not use `*** Begin Patch`, `*** Update File`, or unnumbered `@@` markers.",
          input: {
            type: "object",
            properties: {
              patch: {
                type: "string",
                description:
                  "Standard unified diff, for example: `--- a/README.md\\n+++ b/README.md\\n@@ -1,1 +1,2 @@\\n # Project\\n+Verified.`",
              },
            },
            required: ["patch"],
            additionalProperties: false,
          },
          options: { namespace: "relay", permission: "edit", codemode: true },
          async execute(input, tool) {
            const patch = String((input as { patch: string }).patch);
            await tool.progress({ status: "Applying the patch" });
            return { content: await workspace.applyPatch(patch) };
          },
        });
      });
    },
  };
}

function runnerProgress(event: RunnerEvent): string {
  if (event.type === "status") return event.message.slice(0, 500);
  if (event.type === "result")
    return `Process exited ${event.exitCode} in ${(event.durationMs / 1_000).toFixed(1)}s`;
  const line = event.data.trim();
  return line
    ? line.slice(-500)
    : event.type === "stdout"
      ? "Command produced output"
      : "Command produced error output";
}

function parseModelRef(ref: string) {
  const [providerID, ...modelParts] = ref.split("/");
  return { providerID, model: modelParts.join("/") };
}

export function hasLiveOpenCode(env: WorkerEnv) {
  if (env.OPENCODE_MODE !== "live") return false;
  return env.OPENCODE_PROVIDER === "opencode-zen"
    ? Boolean(env.OPENCODE_ZEN_API_KEY)
    : Boolean(env.CLOUDFLARE_API_TOKEN);
}

export async function createOpenCode(
  storage: DurableObjectStorage,
  env: WorkerEnv,
  workspace: RepositoryWorkspace,
) {
  const { OpenCodeWorkerd } = await import("@opencode-ai/sdk/workerd");
  const live = hasLiveOpenCode(env);
  const selected = parseModelRef(env.OPENCODE_MODEL);
  const liveConfig: OpenCodeWorkerd.Configuration =
    env.OPENCODE_PROVIDER === "opencode-zen"
      ? ({
          default_agent: "build",
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
          model: selected,
          providers: {
            opencode: {
              name: "OpenCode Zen",
              package: "@opencode-ai/ai/providers/openai-compatible",
              settings: {
                baseURL: "https://opencode.ai/zen/v1",
                apiKey: env.OPENCODE_ZEN_API_KEY,
              },
              models: {
                [selected.model]: {
                  modelID: selected.model,
                  capabilities: {
                    tools: true,
                    input: ["text", "image"],
                    output: ["text"],
                  },
                  limit: { context: 1_000_000, output: 131_072 },
                },
              },
            },
          },
        } as OpenCodeWorkerd.Configuration)
      : ({
          default_agent: "build",
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
          model: selected,
          providers: {
            "cloudflare-workers-ai": {
              name: "Cloudflare Workers AI",
              package: "@opencode-ai/ai/providers/openai-compatible",
              settings: {
                baseURL: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`,
                apiKey: env.CLOUDFLARE_API_TOKEN,
              },
              models: {
                "@cf/openai/gpt-oss-120b": {
                  modelID: "@cf/openai/gpt-oss-120b",
                  capabilities: {
                    tools: true,
                    input: ["text"],
                    output: ["text"],
                  },
                  limit: { context: 128_000, output: 16_384 },
                },
              },
            },
          },
        } as OpenCodeWorkerd.Configuration);
  const config = live
    ? liveConfig
    : ({
        default_agent: "build",
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      } as OpenCodeWorkerd.Configuration);

  return OpenCodeWorkerd.create({
    storage,
    config,
    plugins: [relayPlugin(workspace)],
  });
}
