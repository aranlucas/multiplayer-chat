import {
  ExecInterruptedError,
  Sandbox,
  SandboxNotFoundError,
  type ExecHandle,
  type ExecResult,
  type SandboxFileEntry,
} from "railway";

export interface RailwaySandboxEnv {
  RAILWAY_TOKEN?: string;
  RAILWAY_API_TOKEN?: string;
  RAILWAY_ENVIRONMENT_ID?: string;
  RAILWAY_SANDBOX_CHECKPOINT?: string;
  RAILWAY_SANDBOX_REGION?: string;
  RAILWAY_SANDBOX_IDLE_TIMEOUT_MINUTES?: string;
}

export interface SandboxCommandResult extends ExecResult {
  success: boolean;
}

export interface SandboxCommandOptions {
  cwd?: string;
  timeout?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  retryOnInterrupted?: boolean;
}

interface SandboxRow {
  [key: string]: string | null;
  railway_sandbox_id: string | null;
}

interface RailwaySandboxFactory {
  connect(id: string, options: ReturnType<typeof clientOptions>): Promise<Sandbox>;
  create(options: ReturnType<typeof createOptions>): Promise<Sandbox>;
  create(
    checkpoint: string,
    options: ReturnType<typeof createOptions>,
  ): Promise<Sandbox>;
}

const factory: RailwaySandboxFactory = Sandbox;

export class RailwayRoomSandbox {
  private connecting?: Promise<Sandbox>;
  private current?: Sandbox;
  private readonly active = new Set<ExecHandle>();

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: RailwaySandboxEnv,
    private readonly sandboxFactory: RailwaySandboxFactory = factory,
  ) {}

  get configured(): boolean {
    return !this.configurationError();
  }

  configurationError(): string | undefined {
    if (!this.env.RAILWAY_ENVIRONMENT_ID)
      return "The Railway environment ID is not configured.";
    if (!this.env.RAILWAY_TOKEN && !this.env.RAILWAY_API_TOKEN)
      return "A Railway project or API token is not configured.";
    return undefined;
  }

  async exec(
    command: string,
    options: SandboxCommandOptions = {},
  ): Promise<SandboxCommandResult> {
    const sandbox = await this.get();
    try {
      return await this.runExec(sandbox, command, options);
    } catch (error) {
      if (
        !options.retryOnInterrupted ||
        !(error instanceof ExecInterruptedError) ||
        !(await this.isStillRunning(sandbox))
      )
        throw error;
      return this.runExec(sandbox, command, options);
    }
  }

  private async runExec(
    sandbox: Sandbox,
    command: string,
    options: SandboxCommandOptions,
  ): Promise<SandboxCommandResult> {
    const handle = sandbox.exec(command, execOptions(options));
    this.active.add(handle);
    try {
      const result = await handle;
      return { ...result, success: result.exitCode === 0 && !result.timedOut };
    } finally {
      this.active.delete(handle);
    }
  }

  private async isStillRunning(sandbox: Sandbox): Promise<boolean> {
    try {
      await sandbox.refresh();
      if (sandbox.status === "RUNNING") return true;
    } catch {
      // The original interruption remains the most useful error to surface.
    }
    if (this.current === sandbox) this.current = undefined;
    return false;
  }

  async detach(
    command: string,
    options: SandboxCommandOptions = {},
  ): Promise<string> {
    const sandbox = await this.get();
    const handle = sandbox.exec(command, execOptions(options));
    const sessionName = await handle.sessionName;
    await handle.detach();
    return sessionName;
  }

  async reattach(
    sessionName: string,
    options: SandboxCommandOptions = {},
  ): Promise<SandboxCommandResult> {
    const sandbox = await this.get();
    const handle = sandbox.exec(
      { sessionName },
      {
        timeoutSec: timeoutSeconds(options.timeout),
        onStdout: options.onStdout,
        onStderr: options.onStderr,
      },
    );
    this.active.add(handle);
    try {
      const result = await handle;
      return { ...result, success: result.exitCode === 0 && !result.timedOut };
    } finally {
      this.active.delete(handle);
    }
  }

  async killActive(): Promise<void> {
    await Promise.allSettled(
      [...this.active].map((handle) => handle.kill("TERM")),
    );
  }

  async readFile(path: string): Promise<string> {
    return (await this.get()).files.read(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await (await this.get()).files.write(path, content);
  }

  async remove(path: string): Promise<void> {
    await (await this.get()).files.remove(path);
  }

  async list(path: string): Promise<SandboxFileEntry[]> {
    return (await this.get()).files.list(path);
  }

  async stat(path: string): Promise<SandboxFileEntry> {
    return (await this.get()).files.stat(path);
  }

  async destroy(): Promise<void> {
    const sandbox = await this.getExisting();
    if (!sandbox) return;
    await sandbox.destroy();
    this.current = undefined;
    this.setSandboxID(null);
  }

  async get(): Promise<Sandbox> {
    const error = this.configurationError();
    if (error) throw new Error(error);
    if (this.current?.status === "RUNNING") return this.current;
    if (!this.connecting) {
      this.connecting = this.connectOrCreate().finally(() => {
        this.connecting = undefined;
      });
    }
    this.current = await this.connecting;
    return this.current;
  }

  private async connectOrCreate(): Promise<Sandbox> {
    const id = this.sandboxID();
    if (id) {
      try {
        const sandbox = await this.sandboxFactory.connect(
          id,
          clientOptions(this.env),
        );
        if (sandbox.status === "RUNNING") return sandbox;
      } catch (error) {
        if (!(error instanceof SandboxNotFoundError)) throw error;
      }
      this.setSandboxID(null);
    }

    const options = createOptions(this.env);
    const checkpoint = this.env.RAILWAY_SANDBOX_CHECKPOINT?.trim();
    const sandbox = checkpoint
      ? await this.sandboxFactory.create(checkpoint, options)
      : await this.sandboxFactory.create(options);
    this.setSandboxID(sandbox.id);
    return sandbox;
  }

  private async getExisting(): Promise<Sandbox | undefined> {
    if (this.current?.status === "RUNNING") return this.current;
    const id = this.sandboxID();
    if (!id || this.configurationError()) return undefined;
    try {
      return await this.sandboxFactory.connect(id, clientOptions(this.env));
    } catch (error) {
      if (error instanceof SandboxNotFoundError) {
        this.setSandboxID(null);
        return undefined;
      }
      throw error;
    }
  }

  private sandboxID(): string | undefined {
    return (
      this.storage.sql
        .exec<SandboxRow>(
          "SELECT railway_sandbox_id FROM relay_room WHERE singleton = 1",
        )
        .one().railway_sandbox_id ?? undefined
    );
  }

  private setSandboxID(id: string | null) {
    this.storage.sql.exec(
      "UPDATE relay_room SET railway_sandbox_id = ? WHERE singleton = 1",
      id,
    );
  }
}

function clientOptions(env: RailwaySandboxEnv) {
  const token = env.RAILWAY_TOKEN ?? env.RAILWAY_API_TOKEN ?? "";
  return {
    token,
    authType: env.RAILWAY_TOKEN
      ? ("project-token" as const)
      : ("bearer" as const),
    environmentId: env.RAILWAY_ENVIRONMENT_ID,
    fetch: railwayFetch,
  };
}

const railwayFetch: typeof fetch = (input, init) => fetch(input, init);

function createOptions(env: RailwaySandboxEnv) {
  return {
    ...clientOptions(env),
    idleTimeoutMinutes: idleTimeoutMinutes(
      env.RAILWAY_SANDBOX_IDLE_TIMEOUT_MINUTES,
    ),
    ...(env.RAILWAY_SANDBOX_REGION?.trim()
      ? { region: env.RAILWAY_SANDBOX_REGION.trim() }
      : {}),
  };
}

function execOptions(options: SandboxCommandOptions) {
  return {
    cwd: options.cwd,
    timeoutSec: timeoutSeconds(options.timeout),
    onStdout: options.onStdout,
    onStderr: options.onStderr,
  };
}

function timeoutSeconds(milliseconds: number | undefined): number | undefined {
  return milliseconds === undefined
    ? undefined
    : Math.max(1, Math.ceil(milliseconds / 1_000));
}

function idleTimeoutMinutes(value: string | undefined): number {
  if (!value) return 120;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 120)
    throw new Error(
      "RAILWAY_SANDBOX_IDLE_TIMEOUT_MINUTES must be between 1 and 120",
    );
  return parsed;
}
