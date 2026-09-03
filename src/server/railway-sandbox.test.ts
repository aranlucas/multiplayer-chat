import {
  ExecInterruptedError,
  type ExecHandle,
  type ExecResult,
  type Sandbox,
} from "railway";
import { describe, expect, it, vi } from "vitest";
import { RailwayRoomSandbox } from "./railway-sandbox";

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
    expect(sandbox.exec).toHaveBeenNthCalledWith(
      2,
      "rg --files",
      expect.any(Object),
    );
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

    await expect(
      roomSandbox.exec("rg --files", { retryOnInterrupted: true }),
    ).rejects.toBe(interrupted);
    expect(sandbox.exec).toHaveBeenCalledTimes(1);
    expect(sandbox.refresh).toHaveBeenCalledTimes(1);
  });
});

function fakeSandbox(...handles: ExecHandle[]): Sandbox & {
  exec: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
} {
  return {
    id: "sandbox-1",
    status: "RUNNING",
    exec: vi.fn().mockImplementation(() => handles.shift()),
    refresh: vi.fn().mockResolvedValue(undefined),
  } as unknown as Sandbox & {
    exec: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
  };
}

function fakeExecHandle(
  outcome: ExecResult | Error,
  sessionName: string | Error,
): ExecHandle {
  const result =
    outcome instanceof Error
      ? Promise.reject(outcome)
      : Promise.resolve(outcome);
  return Object.assign(result, {
    sessionName:
      sessionName instanceof Error
        ? Promise.reject(sessionName)
        : Promise.resolve(sessionName),
    kill: vi.fn().mockResolvedValue(true),
    detach: vi.fn().mockResolvedValue(undefined),
    result: () => result,
  }) as unknown as ExecHandle;
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

function railwayRoomSandbox(sandbox: Sandbox): RailwayRoomSandbox {
  const storage = {
    sql: {
      exec: vi.fn(() => ({
        one: () => ({ railway_sandbox_id: null }),
      })),
    },
  } as unknown as DurableObjectStorage;
  const sandboxFactory = {
    connect: vi.fn(),
    create: vi.fn().mockResolvedValue(sandbox),
  } as unknown as ConstructorParameters<typeof RailwayRoomSandbox>[2];

  return new RailwayRoomSandbox(
    storage,
    {
      RAILWAY_TOKEN: "railway-test-token",
      RAILWAY_ENVIRONMENT_ID: "railway-test-environment",
    },
    sandboxFactory,
  );
}
