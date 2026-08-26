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

function relayPlugin(workspace: RepositoryWorkspace): Plugin {
  return {
    id: "relay.collaboration",
    async setup(ctx) {
      await ctx.agent.transform((agents) => {
        agents.update("build", (agent) => {
          const instructions =
            "Investigates and modifies the room's real, commit-pinned GitHub workspace. Use bash or its shell alias for repository inspection, search, Git status and diffs, file creation or deletion, dependency installation, and verification commands. Bash starts from the room's durable overlay and writes all resulting UTF-8 file changes back to it, even when a command exits non-zero. Each room keeps its isolated sandbox disk between Bash calls, so installed dependencies and caches remain available. Use edit for precise replacements in existing files; paths are relative to the repository. Explain evidence from tool output. This room runs in dangerous always-allow mode, so tools do not pause for approval.";
          agent.description = instructions;
          agent.system = `${instructions} Your only repository tools are bash, shell, and edit. Do not use read, write, glob, grep, apply_patch, or other built-in filesystem tools because they address the Workerd bundle rather than the shared repository.`;
          agent.permissions = relayPermissions();
        });
      });

      await ctx.tool.transform((tools) => {
        for (const name of ["bash", "shell"] as const) {
          tools.add({
            name,
            description:
              "Execute one shell command in the room's commit-pinned repository. The command runs in a hardware-isolated Linux sandbox with dangerous always-allow authority. Tracked, untracked, modified, and deleted UTF-8 text files are synchronized back to the shared Durable Object after the command, including when it exits non-zero. Use shell commands such as rg, sed, git, and package-manager scripts for all repository inspection and verification.",
            input: {
              type: "object",
              properties: { command: { type: "string" } },
              required: ["command"],
              additionalProperties: false,
            },
            options: { permission: name, codemode: false },
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
        }

        tools.add({
          name: "edit",
          description:
            "Perform an exact string replacement in an existing UTF-8 repository file and persist it to the shared Durable Object. oldString must match exactly, including whitespace. By default it must match once; set replaceAll only when every exact occurrence should change.",
          input: {
            type: "object",
            properties: {
              filePath: {
                type: "string",
                description:
                  "Repository-relative path, or an absolute path beneath /workspace/repository.",
              },
              oldString: { type: "string" },
              newString: { type: "string" },
              replaceAll: { type: "boolean", default: false },
            },
            required: ["filePath", "oldString", "newString"],
            additionalProperties: false,
          },
          options: { permission: "edit", codemode: false },
          async execute(input, tool) {
            const edit = input as {
              filePath: string;
              oldString: string;
              newString: string;
              replaceAll?: boolean;
            };
            await tool.progress({ status: `Editing ${edit.filePath}` });
            return {
              content: await workspace.editFile(
                String(edit.filePath),
                String(edit.oldString),
                String(edit.newString),
                edit.replaceAll === true,
              ),
            };
          },
        });
      });
    },
  };
}

function runnerProgress(event: RunnerEvent): string {
  if (event.type === "status") return event.message.slice(0, 500);
  if (event.type === "changes")
    return `${event.changes.length} changed file${event.changes.length === 1 ? "" : "s"} synchronized`;
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

function relayPermissions() {
  return [
    { action: "*", resource: "*", effect: "deny" as const },
    { action: "bash", resource: "*", effect: "allow" as const },
    { action: "shell", resource: "*", effect: "allow" as const },
    { action: "edit", resource: "*", effect: "allow" as const },
  ];
}

export function hasLiveOpenCode(env: WorkerEnv) {
  if (env.OPENCODE_MODE !== "live") return false;
  return env.OPENCODE_PROVIDER === "opencode-zen"
    ? Boolean(env.OPENCODE_ZEN_API_KEY) ||
        parseModelRef(env.OPENCODE_MODEL).model.endsWith("-free")
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
          permissions: relayPermissions(),
          model: selected,
          providers: {
            opencode: {
              name: "OpenCode Zen",
              package: "@opencode-ai/ai/providers/openai-compatible",
              settings: {
                baseURL: "https://opencode.ai/zen/v1",
                ...(env.OPENCODE_ZEN_API_KEY
                  ? { apiKey: env.OPENCODE_ZEN_API_KEY }
                  : {}),
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
          permissions: relayPermissions(),
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
        permissions: relayPermissions(),
      } as OpenCodeWorkerd.Configuration);

  return OpenCodeWorkerd.create({
    storage,
    config,
    plugins: [relayPlugin(workspace)],
  });
}
