import { describe, expect, it, vi } from "vitest";

import { railwayToolDefinitions, type RailwayToolDependencies } from "./railway-tools";

describe("railwayTools", () => {
  it("checkpoints an edit immediately after writing it", async () => {
    const sandbox = {
      readFile: vi.fn().mockResolvedValue("const enabled = false;\n"),
      writeFile: vi.fn().mockResolvedValue(undefined),
    };

    const checkpointWorkspace = vi.fn().mockResolvedValue(undefined);

    const tools = registeredTools(sandboxFixture(sandbox), checkpointWorkspace);

    const edit = tools.get("edit");

    if (!edit) {
      throw new Error("edit tool was not registered");
    }

    await edit.execute(
      {
        path: "src/feature.ts",
        oldString: "false",
        newString: "true",
      },
      { progress: async () => {} },
    );

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

    const tools = registeredTools(sandboxFixture(sandbox), checkpointWorkspace);

    const shell = tools.get("shell");

    if (!shell) {
      throw new Error("shell tool was not registered");
    }

    await shell.execute(
      { command: "apply-some-change" },
      { progress: vi.fn().mockResolvedValue(undefined) },
    );

    expect(checkpointWorkspace).toHaveBeenCalledOnce();
  });
});

function sandboxFixture(
  overrides: Partial<RailwayToolDependencies["sandbox"]>,
): RailwayToolDependencies["sandbox"] {
  return {
    exec: vi.fn(),
    reattach: vi.fn(),
    detach: vi.fn(),
    stat: vi.fn(),
    list: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    ...overrides,
  };
}

function registeredTools(
  sandbox: RailwayToolDependencies["sandbox"],
  checkpointWorkspace: () => Promise<void>,
) {
  return new Map(
    railwayToolDefinitions({ sandbox, ensureWorkspace: async () => {}, checkpointWorkspace }).map(
      (tool) => [tool.name, tool],
    ),
  );
}
