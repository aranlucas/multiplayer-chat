import { ExecInterruptedError, type ExecResult, type Sandbox } from "railway";
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
  it("retries an interrupted idempotent command when the sandbox is alive", async () => {
    const interrupted = new ExecInterruptedError({
      closeCode: 1006,
      reason: "WebSocket disconnected without sending Close frame.",
      stdout: "",
      stderr: "",
    });
    const sandbox = fakeSandbox(interrupted, successfulResult);
    const roomSandbox = railwayRoomSandbox(sandbox);

    await expect(
      roomSandbox.exec("rg --files", { retryOnInterrupted: true }),
    ).resolves.toMatchObject({
      ...successfulResult,
      success: true,
    });
    expect(sandbox.exec).toHaveBeenCalledTimes(2);
    expect(sandbox.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not retry commands unless the caller declares them idempotent", async () => {
    const interrupted = new ExecInterruptedError({
      closeCode: 1006,
      reason: "WebSocket disconnected without sending Close frame.",
      stdout: "partial output",
      stderr: "",
    });
    const sandbox = fakeSandbox(interrupted, successfulResult);
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
    const sandbox = fakeSandbox(interrupted, successfulResult);
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

function fakeSandbox(
  first: Error,
  second: ExecResult,
): Sandbox & {
  exec: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
} {
  return {
    id: "sandbox-1",
    status: "RUNNING",
    exec: vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(first))
      .mockImplementationOnce(() => Promise.resolve(second)),
    refresh: vi.fn().mockResolvedValue(undefined),
  } as unknown as Sandbox & {
    exec: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
  };
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
