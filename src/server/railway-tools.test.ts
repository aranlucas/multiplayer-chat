import { describe, expect, it, vi } from "vitest";
import type { RailwayRoomSandbox } from "./railway-sandbox";
import { railwayTools } from "./railway-tools";

describe("railwayTools", () => {
  it("checkpoints an edit immediately after writing it", async () => {
    const sandbox = {
      readFile: vi.fn().mockResolvedValue("const enabled = false;\n"),
      writeFile: vi.fn().mockResolvedValue(undefined),
    };
    const checkpointWorkspace = vi.fn().mockResolvedValue(undefined);
    const tools = await registeredTools(
      sandbox as unknown as RailwayRoomSandbox,
      checkpointWorkspace,
    );

    await tools.get("edit")!.execute({
      path: "src/feature.ts",
      oldString: "false",
      newString: "true",
    });

    expect(sandbox.writeFile).toHaveBeenCalledWith(
      "/workspace/repository/src/feature.ts",
      "const enabled = true;\n",
    );
    expect(checkpointWorkspace).toHaveBeenCalledOnce();
    expect(sandbox.writeFile.mock.invocationCallOrder[0]).toBeLessThan(
      checkpointWorkspace.mock.invocationCallOrder[0],
    );
  });

  it("checkpoints foreground shell changes before returning", async () => {
    const sandbox = {
      exec: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        truncated: false,
        timedOut: false,
        success: true,
      }),
    };
    const checkpointWorkspace = vi.fn().mockResolvedValue(undefined);
    const tools = await registeredTools(
      sandbox as unknown as RailwayRoomSandbox,
      checkpointWorkspace,
    );

    await tools
      .get("shell")!
      .execute(
        { command: "apply-some-change" },
        { progress: vi.fn().mockResolvedValue(undefined) },
      );

    expect(checkpointWorkspace).toHaveBeenCalledOnce();
  });
});

interface RegisteredTool {
  execute(input: unknown, context?: unknown): Promise<unknown>;
}

async function registeredTools(
  sandbox: RailwayRoomSandbox,
  checkpointWorkspace: () => Promise<unknown>,
): Promise<Map<string, RegisteredTool>> {
  const tools = new Map<string, RegisteredTool>();
  const registration = { dispose: vi.fn().mockResolvedValue(undefined) };
  const plugin = railwayTools({
    sandbox,
    ensureWorkspace: vi.fn().mockResolvedValue(undefined),
    checkpointWorkspace,
  });
  await plugin.setup({
    tool: {
      transform: async (
        callback: (draft: {
          add(tool: RegisteredTool & { name: string }): void;
          remove(name: string): void;
        }) => void,
      ) => {
        callback({
          add: (tool) => tools.set(tool.name, tool),
          remove: vi.fn(),
        });
        return registration;
      },
    },
    session: { hook: vi.fn().mockResolvedValue(registration) },
  } as never);
  return tools;
}
