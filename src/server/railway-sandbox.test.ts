import { sqliteStorage } from "./fixtures/sqlite-storage";
import { ExecInterruptedError, type ExecResult } from "railway";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RailwayRoomSandbox,
  type SandboxConnection,
  type SandboxExecution,
} from "./railway-sandbox";

const databases: ReturnType<typeof sqliteStorage>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

const successfulResult: ExecResult = {
  exitCode: 0,
  stdout: "README.md\n",
  stderr: "",
  truncated: false,
  timedOut: false,
};

describe("RailwayRoomSandbox.exec", () => {
  it("reattaches an interrupted command without running it twice", async () => {
    const interrupted = execInterrupted({
      stdout: "partial ",
      stderr: "warning ",
    });

    const resumedResult = {
      ...successfulResult,
      stdout: "output\n",
      stderr: "continued\n",
    };

    const sandbox = fakeSandbox(
      fakeExecHandle(interrupted, "exec-session-1"),
      fakeExecHandle(resumedResult, "exec-session-1"),
    );

    const roomSandbox = railwayRoomSandbox(sandbox);

    await expect(roomSandbox.exec("pnpm test")).resolves.toMatchObject({
      ...resumedResult,
      stdout: "partial output\n",
      stderr: "warning continued\n",
      success: true,
    });
    expect(sandbox.exec).toHaveBeenCalledTimes(2);
    expect(sandbox.exec).toHaveBeenNthCalledWith(
      2,
      { sessionName: "exec-session-1" },
      expect.objectContaining({ resumeFromLastRead: true }),
    );
    expect(sandbox.refresh).toHaveBeenCalledTimes(1);
  });

  it("retries an interrupted idempotent command when no durable session is available", async () => {
    const interrupted = new ExecInterruptedError({
      closeCode: 1006,
      reason: "WebSocket disconnected without sending Close frame.",
      stdout: "",
      stderr: "",
    });

    const sandbox = fakeSandbox(
      fakeExecHandle(interrupted, new Error("No durable session")),
      fakeExecHandle(successfulResult, "exec-session-2"),
    );

    const roomSandbox = railwayRoomSandbox(sandbox);

    await expect(
      roomSandbox.exec("rg --files", { retryOnInterrupted: true }),
    ).resolves.toMatchObject({
      ...successfulResult,
      success: true,
    });
    expect(sandbox.exec).toHaveBeenCalledTimes(2);
    expect(sandbox.exec).toHaveBeenNthCalledWith(2, "rg --files", expect.any(Object));
    expect(sandbox.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not retry commands unless the caller declares them idempotent", async () => {
    const interrupted = new ExecInterruptedError({
      closeCode: 1006,
      reason: "WebSocket disconnected without sending Close frame.",
      stdout: "partial output",
      stderr: "",
    });

    const sandbox = fakeSandbox(
      fakeExecHandle(interrupted, new Error("No durable session")),
      fakeExecHandle(successfulResult, "exec-session-2"),
    );

    const roomSandbox = railwayRoomSandbox(sandbox);

    await expect(roomSandbox.exec("pnpm test")).rejects.toBe(interrupted);
    expect(sandbox.exec).toHaveBeenCalledTimes(1);
    expect(sandbox.refresh).not.toHaveBeenCalled();
  });

  it("does not retry against a sandbox that is no longer running", async () => {
    const interrupted = new ExecInterruptedError({
      closeCode: 1006,
      reason: "WebSocket disconnected without sending Close frame.",
      stdout: "",
      stderr: "",
    });

    const sandbox = fakeSandbox(
      fakeExecHandle(interrupted, "exec-session-1"),
      fakeExecHandle(successfulResult, "exec-session-2"),
    );

    sandbox.refresh.mockImplementation(async () => {
      Object.defineProperty(sandbox, "status", { value: "DESTROYED" });

      return sandbox;
    });
    const roomSandbox = railwayRoomSandbox(sandbox);

    await expect(roomSandbox.exec("rg --files", { retryOnInterrupted: true })).rejects.toBe(
      interrupted,
    );
    expect(sandbox.exec).toHaveBeenCalledTimes(1);
    expect(sandbox.refresh).toHaveBeenCalledTimes(1);
  });
});

function fakeSandbox(...handles: SandboxExecution[]) {
  const exec = vi.fn((..._args: Parameters<SandboxConnection["exec"]>) => {
    const handle = handles.shift();

    if (!handle) {
      throw new Error("Unexpected execution");
    }

    return handle;
  });

  const refresh = vi.fn<() => Promise<void | SandboxConnection>>().mockResolvedValue(undefined);

  const sandbox: SandboxConnection & { exec: typeof exec; refresh: typeof refresh } = {
    id: "sandbox-1",
    status: "RUNNING",
    exec,
    refresh,
    files: { read: vi.fn(), write: vi.fn(), list: vi.fn(), stat: vi.fn() },
  };

  return sandbox;
}

function fakeExecHandle(
  outcome: ExecResult | Error,
  sessionName: string | Error,
): SandboxExecution {
  const result = outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);

  return Object.assign(result, {
    sessionName:
      sessionName instanceof Error ? Promise.reject(sessionName) : Promise.resolve(sessionName),
    kill: vi.fn().mockResolvedValue(true),
    detach: vi.fn().mockResolvedValue(undefined),
    result: () => result,
  });
}

function execInterrupted({
  stdout = "",
  stderr = "",
}: {
  stdout?: string;
  stderr?: string;
} = {}): ExecInterruptedError {
  return new ExecInterruptedError({
    closeCode: 1006,
    reason: "WebSocket disconnected without sending Close frame.",
    stdout,
    stderr,
  });
}

function railwayRoomSandbox(sandbox: SandboxConnection): RailwayRoomSandbox {
  const database = sqliteStorage();
  database.sql.exec(
    "CREATE TABLE relay_room (singleton INTEGER PRIMARY KEY, railway_sandbox_id TEXT); INSERT INTO relay_room VALUES (1, NULL);",
  );
  databases.push(database);
  const storage = { sql: database.sql };

  const sandboxFactory = {
    connect: vi.fn().mockResolvedValue(sandbox),
    create: vi.fn().mockResolvedValue(sandbox),
  };

  return new RailwayRoomSandbox(
    storage,
    {
      RAILWAY_TOKEN: "railway-test-token",
      RAILWAY_ENVIRONMENT_ID: "railway-test-environment",
    },
    sandboxFactory,
  );
}
