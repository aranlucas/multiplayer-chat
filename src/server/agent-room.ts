import { DurableObject } from "cloudflare:workers";
import {
  DEFAULT_BRANCH,
  DEFAULT_REPOSITORY,
  PARTICIPANT_COLORS,
  parseClientMessage,
  queuedPrompts,
  type ClientMessage,
  type Participant,
  type PermissionRequest,
  type QueuedPrompt,
  type RoomInfo,
  type RoomRevision,
  type RoomSnapshot,
  type ServerMessage,
  type TimelineEvent,
} from "../shared/protocol";
import { completedTurnStatus } from "./agent-turn";
import {
  hasLiveOpenCode,
  liveOpenCodeConfigurationError,
  type WorkerEnv,
} from "./opencode";
import {
  MicrosandboxRunnerClient,
  type NativeRunnerEvent,
} from "./microsandbox-runner";
import { RepositoryWorkspace } from "./workspace";
import {
  GitHubPullRequestClient,
  type ExistingPullRequest,
  type PullRequestResult,
} from "./github-pull-request";
import {
  sealGitHubCredential,
  unsealGitHubCredential,
} from "./github-auth";

interface SocketAttachment {
  participant: Pick<Participant, "id" | "name" | "role" | "color">;
}

interface EventRow {
  [key: string]: string | number | null;
  seq: number;
  id: string;
  kind: TimelineEvent["kind"];
  created_at: number;
  actor_json: string | null;
  payload_json: string;
  queue_status: "pending" | "consumed" | null;
}

interface ParticipantRow {
  [key: string]: string | number | null;
  id: string;
  name: string;
  role: Participant["role"];
  color: string;
  last_seen: number;
}

interface PermissionRow {
  [key: string]: string | number | null;
  id: string;
  session_id: string;
  action: string;
  resources_json: string;
  message: string | null;
  status: PermissionRequest["status"];
  created_at: number;
}

interface RevisionRow {
  [key: string]: string | number | null;
  id: string;
  sequence: number;
  workspace_revision: number;
  commit_sha: string;
  status: RoomRevision["status"];
  preview_url: string | null;
  provider: string | null;
  deployment_id: string | null;
  failure: string | null;
  created_at: number;
  updated_at: number;
  activated_at: number | null;
}

interface HandoffRow {
  [key: string]: string | number | null;
  token_hash: string;
  target_origin: string;
  participant_json: string;
  expires_at: number;
  used_at: number | null;
}

interface HandoffParticipant {
  id: string;
  name: string;
  role: Participant["role"];
}

interface HandoffClientState {
  draft?: string;
  selectedID?: string;
  mobileTab?: "transcript" | "people" | "queue";
}

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class AgentRoom extends DurableObject<WorkerEnv> {
  private readonly workspace: RepositoryWorkspace;
  private readonly runner: MicrosandboxRunnerClient;
  private roomID = "reconnect-loop";

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    this.migrate();
    this.workspace = new RepositoryWorkspace(ctx.storage, env);
    this.runner = new MicrosandboxRunnerClient(env);
  }

  async initialize(roomID: string): Promise<void> {
    this.roomID = roomID;
    this.ensureRoom(roomID);
    await this.workspace.ensureReady().catch((error) => {
      console.warn("Repository workspace initialization deferred", error);
    });
  }

  async createPullRequest(input: {
    accessToken: string;
    login: string;
    title?: string;
    body?: string;
  }): Promise<PullRequestResult> {
    const room = this.getRoom();
    const workspace = await this.workspace.pullRequestWorkspace();
    const title = cleanPullRequestText(
      input.title,
      `Relay: ${room.title}`,
      160,
    );
    const body = cleanPullRequestText(
      input.body,
      [
        "Created from a collaborative Relay coding-agent session.",
        "",
        `Base commit: \`${workspace.commitSHA}\``,
        `Room: \`${room.id}\``,
        `Changed files: ${workspace.changes.map((change) => `\`${change.path}\``).join(", ")}`,
      ].join("\n"),
      20_000,
    );
    const existing: ExistingPullRequest | undefined =
      room.pullRequestURL &&
      room.pullRequestNumber &&
      room.pullRequestBranch &&
      room.pullRequestRepository &&
      room.pullRequestHeadSHA
        ? {
            number: room.pullRequestNumber,
            url: room.pullRequestURL,
            branch: room.pullRequestBranch,
            writeRepository: room.pullRequestRepository,
            headSHA: room.pullRequestHeadSHA,
          }
        : undefined;
    const result = await new GitHubPullRequestClient(
      input.accessToken,
    ).publish(
      {
        accessToken: input.accessToken,
        login: input.login,
        roomID: room.id,
        repository: workspace.repository,
        baseBranch: workspace.branch,
        baseCommitSHA: workspace.commitSHA,
        changes: workspace.changes,
        title,
        body,
      },
      existing,
    );
    const sealedCredential = await sealGitHubCredential(
      { accessToken: input.accessToken, login: input.login },
      this.env,
    );
    this.ctx.storage.sql.exec(
      "UPDATE relay_room SET pull_request_url = ?, pull_request_number = ?, pull_request_branch = ?, pull_request_repository = ?, pull_request_head_sha = ?, github_credential = ?, published_workspace_revision = workspace_revision WHERE singleton = 1",
      result.url,
      result.number,
      result.branch,
      result.writeRepository,
      result.commitSHA,
      sealedCredential,
    );
    const revision = this.insertRevision({
      workspaceRevision: this.getRoom().workspaceRevision,
      commitSHA: result.commitSHA,
      status: "waiting",
      provider: "github",
    });
    const event = this.insertEvent({
      id: crypto.randomUUID(),
      kind: "system",
      createdAt: Date.now(),
      payload: {
        type: "pull_request",
        text: existing
          ? `@${input.login} published revision ${revision.sequence} to pull request #${result.number}`
          : `@${input.login} created pull request #${result.number}`,
        url: result.url,
        branch: result.branch,
        commitSHA: result.commitSHA,
        revision: revision.sequence,
      },
    });
    this.broadcast({ type: "room", room: this.getRoom() });
    this.broadcast({ type: "event", event });
    await this.ctx.storage.setAlarm(Date.now() + 2_000);
    return result;
  }

  async publishSavedPullRequest(): Promise<PullRequestResult | undefined> {
    const room = this.getRoom();
    if (room.workspaceRevision <= room.publishedWorkspaceRevision)
      return undefined;
    const credential = this.githubCredential();
    if (!credential) return undefined;
    return this.createPullRequest(
      await unsealGitHubCredential(credential, this.env),
    );
  }

  async recordDeployment(input: {
    commitSHA: string;
    status: RoomRevision["status"];
    previewURL?: string;
    provider?: string;
    deploymentID?: string;
    failure?: string;
  }): Promise<RoomRevision> {
    const revision = this.revisionForCommit(input.commitSHA);
    if (!revision)
      throw new Error("Deployment does not match a published room revision");
    const previewURL = input.previewURL
      ? validatePreviewURL(input.previewURL)
      : undefined;
    if (input.status === "ready" && !previewURL)
      throw new Error("A ready deployment requires a preview URL");
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "UPDATE relay_revisions SET status = ?, preview_url = COALESCE(?, preview_url), provider = COALESCE(?, provider), deployment_id = COALESCE(?, deployment_id), failure = ?, updated_at = ? WHERE id = ?",
      input.status,
      previewURL,
      input.provider ?? null,
      input.deploymentID ?? null,
      input.failure ?? null,
      now,
      revision.id,
    );
    const updated = this.revisionByID(revision.id)!;
    if (input.status === "ready" || input.status === "failed") {
      const event = this.insertEvent({
        id: `deployment:${updated.id}:${input.status}`,
        kind: "system",
        createdAt: now,
        payload: {
          type: "deployment",
          status: input.status,
          text:
            input.status === "ready"
              ? `Revision ${updated.sequence} preview is ready`
              : `Revision ${updated.sequence} preview failed`,
          url: updated.previewURL,
          failure: updated.failure,
          revision: updated.sequence,
          commitSHA: updated.commitSHA,
        },
      });
      this.broadcast({ type: "event", event });
    }
    this.broadcast({ type: "room", room: this.getRoom() });
    return updated;
  }

  async createLocalPreview(input: {
    previewURL: string;
    commitSHA?: string;
  }): Promise<RoomRevision> {
    const room = this.getRoom();
    const workspaceRevision = room.workspaceRevision + 1;
    const commitSHA =
      input.commitSHA ??
      `local-${workspaceRevision}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    this.ctx.storage.sql.exec(
      "UPDATE relay_room SET workspace_revision = ?, published_workspace_revision = ? WHERE singleton = 1",
      workspaceRevision,
      workspaceRevision,
    );
    const revision = this.insertRevision({
      workspaceRevision,
      commitSHA,
      status: "ready",
      previewURL: validatePreviewURL(input.previewURL),
      provider: "local",
    });
    const event = this.insertEvent({
      id: `deployment:${revision.id}:ready`,
      kind: "system",
      createdAt: revision.createdAt,
      payload: {
        type: "deployment",
        status: "ready",
        text: `Revision ${revision.sequence} preview is ready`,
        url: revision.previewURL,
        revision: revision.sequence,
        commitSHA: revision.commitSHA,
      },
    });
    this.broadcast({ type: "event", event });
    this.broadcast({ type: "room", room: this.getRoom() });
    return revision;
  }

  async createHandoff(input: {
    participant: HandoffParticipant;
    clientState?: HandoffClientState;
    currentOrigin: string;
    controlOrigin: string;
  }): Promise<{ url: string; expiresAt: number }> {
    const revision = this.latestRevision();
    if (!revision?.previewURL || revision.status !== "ready")
      throw new Error("The latest room preview is not ready");
    const target = new URL(revision.previewURL);
    const currentOrigin = new URL(input.currentOrigin).origin;
    const controlOrigin = new URL(input.controlOrigin).origin;
    if (target.origin === currentOrigin)
      throw new Error("The room is already on the latest preview");
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll(
      "-",
      "",
    );
    const tokenHash = await sha256(token);
    const expiresAt = Date.now() + 60_000;
    this.ctx.storage.sql.exec(
      "INSERT INTO relay_handoffs (token_hash, revision_id, target_origin, participant_json, expires_at) VALUES (?, ?, ?, ?, ?)",
      tokenHash,
      revision.id,
      target.origin,
      JSON.stringify({
        participant: input.participant,
        clientState: validateHandoffClientState(input.clientState),
      }),
      expiresAt,
    );
    target.pathname = `/r/${encodeURIComponent(this.roomID)}`;
    target.searchParams.set("control", controlOrigin);
    target.hash = `handoff=${token}`;
    return { url: target.toString(), expiresAt };
  }

  async redeemHandoff(input: {
    token: string;
    targetOrigin: string;
  }): Promise<{
    participant: HandoffParticipant;
    clientState?: HandoffClientState;
    roomID: string;
  }> {
    if (!/^[a-f0-9]{64}$/i.test(input.token))
      throw new Error("Invalid room handoff ticket");
    const tokenHash = await sha256(input.token);
    const rows = this.ctx.storage.sql
      .exec<HandoffRow>(
        "SELECT * FROM relay_handoffs WHERE token_hash = ?",
        tokenHash,
      )
      .toArray();
    const handoff = rows[0];
    if (!handoff || handoff.used_at || handoff.expires_at <= Date.now())
      throw new Error("Room handoff ticket is expired or already used");
    if (new URL(input.targetOrigin).origin !== handoff.target_origin)
      throw new Error("Room handoff ticket was issued for another preview");
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "UPDATE relay_handoffs SET used_at = ? WHERE token_hash = ? AND used_at IS NULL",
      now,
      tokenHash,
    );
    this.ctx.storage.sql.exec(
      "UPDATE relay_revisions SET activated_at = COALESCE(activated_at, ?) WHERE id = (SELECT revision_id FROM relay_handoffs WHERE token_hash = ?)",
      now,
      tokenHash,
    );
    this.broadcast({ type: "room", room: this.getRoom() });
    const stored = JSON.parse(handoff.participant_json) as {
      participant: HandoffParticipant;
      clientState?: HandoffClientState;
    };
    return {
      participant: stored.participant,
      clientState: stored.clientState,
      roomID: this.roomID,
    };
  }

  async activateRevision(input: {
    revisionID: string;
    currentOrigin: string;
  }): Promise<RoomRevision> {
    const revision = this.revisionByID(input.revisionID);
    if (!revision?.previewURL || revision.status !== "ready")
      throw new Error("Room revision is not ready");
    if (
      new URL(revision.previewURL).origin !==
      new URL(input.currentOrigin).origin
    )
      throw new Error("Room revision belongs to another preview origin");
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "UPDATE relay_revisions SET activated_at = COALESCE(activated_at, ?) WHERE id = ?",
      now,
      revision.id,
    );
    const updated = this.revisionByID(revision.id)!;
    this.broadcast({ type: "room", room: this.getRoom() });
    return updated;
  }

  async alarm(): Promise<void> {
    const room = this.getRoomOrNull();
    if (!room?.pullRequestHeadSHA) return;
    const revision = room.latestRevision;
    if (
      !revision ||
      revision.commitSHA !== room.pullRequestHeadSHA ||
      revision.status === "ready" ||
      revision.status === "failed"
    )
      return;
    if (Date.now() - revision.createdAt > 15 * 60_000) {
      await this.recordDeployment({
        commitSHA: revision.commitSHA,
        status: "failed",
        provider: revision.provider,
        failure: "Preview deployment was not ready within 15 minutes",
      });
      return;
    }
    const credential = this.githubCredential();
    if (!credential) return;
    const session = await unsealGitHubCredential(credential, this.env);
    const observation = await new GitHubPullRequestClient(
      session.accessToken,
    ).findDeployment(room.repository, room.pullRequestHeadSHA);
    if (observation.status === "ready" && observation.environmentURL) {
      await verifyReadyPreview(
        observation.environmentURL,
        room.pullRequestHeadSHA,
      );
    }
    await this.recordDeployment({
      commitSHA: room.pullRequestHeadSHA,
      status: observation.status,
      previewURL: observation.environmentURL,
      provider: "github",
      deploymentID: observation.deploymentID,
      failure: observation.failure,
    });
    if (observation.status === "waiting" || observation.status === "building")
      await this.ctx.storage.setAlarm(Date.now() + 5_000);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json(await this.snapshot());
    }

    const url = new URL(request.url);
    const name = url.searchParams.get("name") ?? "Guest";
    const id = url.searchParams.get("participant") ?? crypto.randomUUID();
    const requestedRole = url.searchParams.get("role");
    const role = requestedRole === "contributor" ? "contributor" : "maintainer";
    const colorIndex = Math.abs(hashCode(id)) % PARTICIPANT_COLORS.length;
    const participant = {
      id,
      name,
      role,
      color: PARTICIPANT_COLORS[colorIndex],
    } as const;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ participant } satisfies SocketAttachment);
    this.upsertParticipant(participant);
    server.send(JSON.stringify(await this.snapshot()));
    this.broadcastPresence();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    socket: WebSocket,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    const attachment =
      socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;

    try {
      const text =
        typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      const message = parseClientMessage(JSON.parse(text));
      await this.handleClientMessage(socket, attachment.participant, message);
    } catch (error) {
      this.send(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "Invalid message",
      });
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const attachment =
      socket.deserializeAttachment() as SocketAttachment | null;
    if (attachment) {
      this.ctx.storage.sql.exec(
        "UPDATE relay_participants SET last_seen = ? WHERE id = ?",
        Date.now(),
        attachment.participant.id,
      );
    }
    this.broadcastPresence();
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  private migrate() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS relay_room (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        room_id TEXT NOT NULL,
        title TEXT NOT NULL,
        repository TEXT NOT NULL,
        branch TEXT NOT NULL,
        agent_status TEXT NOT NULL,
        opencode_session_id TEXT,
        opencode_event_cursor TEXT,
        commit_sha TEXT,
        workspace_status TEXT NOT NULL DEFAULT 'cloning',
        workspace_error TEXT
      );
      CREATE TABLE IF NOT EXISTS relay_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        actor_json TEXT,
        payload_json TEXT NOT NULL,
        queue_status TEXT
      );
      CREATE TABLE IF NOT EXISTS relay_participants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        color TEXT NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relay_permissions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resources_json TEXT NOT NULL,
        message TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relay_revisions (
        id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL UNIQUE,
        workspace_revision INTEGER NOT NULL,
        commit_sha TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        preview_url TEXT,
        provider TEXT,
        deployment_id TEXT,
        failure TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        activated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS relay_handoffs (
        token_hash TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL,
        target_origin TEXT NOT NULL,
        participant_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS relay_events_created_idx ON relay_events(created_at);
      CREATE INDEX IF NOT EXISTS relay_handoffs_expiry_idx ON relay_handoffs(expires_at);
    `);
    this.ensureColumn("relay_room", "commit_sha", "TEXT");
    this.ensureColumn(
      "relay_room",
      "workspace_status",
      "TEXT NOT NULL DEFAULT 'cloning'",
    );
    this.ensureColumn("relay_room", "workspace_error", "TEXT");
    this.ensureColumn("relay_room", "opencode_event_cursor", "TEXT");
    this.ensureColumn(
      "relay_room",
      "agent_turn_generation",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureColumn("relay_events", "queue_status", "TEXT");
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS relay_events_queue_idx ON relay_events(queue_status, seq)",
    );
    this.ensureColumn("relay_room", "pull_request_url", "TEXT");
    this.ensureColumn("relay_room", "pull_request_branch", "TEXT");
    this.ensureColumn("relay_room", "pull_request_number", "INTEGER");
    this.ensureColumn("relay_room", "pull_request_repository", "TEXT");
    this.ensureColumn("relay_room", "pull_request_head_sha", "TEXT");
    this.ensureColumn("relay_room", "github_credential", "TEXT");
    this.ensureColumn(
      "relay_room",
      "workspace_revision",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ensureColumn(
      "relay_room",
      "published_workspace_revision",
      "INTEGER NOT NULL DEFAULT 0",
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM relay_events WHERE id LIKE 'seed-%'",
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM relay_permissions WHERE id = 'demo-deploy'",
    );
    this.ctx.storage.sql.exec(
      "UPDATE relay_room SET branch = 'master', commit_sha = NULL, workspace_status = 'cloning', workspace_error = NULL WHERE repository = 'cloudflare/workers-chat-demo' AND branch IN ('fix/session-reconnect', 'main')",
    );
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.ctx.storage.sql
      .exec<{ name: string }>(`PRAGMA table_info(${table})`)
      .toArray();
    if (!columns.some((candidate) => candidate.name === column)) {
      this.ctx.storage.sql.exec(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
      );
    }
  }

  private ensureRoom(roomID: string) {
    const existing = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM relay_room")
      .one();
    if (existing.count) return;

    this.ctx.storage.sql.exec(
      "INSERT INTO relay_room (singleton, room_id, title, repository, branch, agent_status, workspace_status) VALUES (1, ?, ?, ?, ?, ?, ?)",
      roomID,
      "Investigate reconnect loop",
      DEFAULT_REPOSITORY,
      DEFAULT_BRANCH,
      "idle",
      "cloning",
    );
  }

  private async handleClientMessage(
    socket: WebSocket,
    participant: SocketAttachment["participant"],
    message: ClientMessage,
  ) {
    if (message.type === "ping") {
      this.send(socket, { type: "ack" });
      return;
    }

    if (message.type === "permission.reply") {
      if (participant.role !== "maintainer")
        throw new Error("Only maintainers can resolve side effects");
      await this.replyToPermission(
        message.requestID,
        message.reply,
        participant,
      );
      this.send(socket, { type: "ack", requestID: message.requestID });
      return;
    }

    if (message.type === "room.configure") {
      if (participant.role !== "maintainer")
        throw new Error("Only maintainers can change the repository");
      const info = await this.workspace.configure(
        message.repository,
        message.branch,
      );
      const event = this.insertEvent({
        id: crypto.randomUUID(),
        kind: "system",
        createdAt: Date.now(),
        actor: participant,
        payload: {
          type: "repository",
          text: `Workspace changed to ${info.repository}@${info.branch}`,
          commitSHA: info.commitSHA,
        },
      });
      this.broadcast({ type: "room", room: this.getRoom() });
      this.broadcast({ type: "event", event });
      this.send(socket, { type: "ack", requestID: message.requestID });
      return;
    }

    if (message.type === "room.rename") {
      if (participant.role !== "maintainer")
        throw new Error("Only maintainers can rename the room");
      this.ctx.storage.sql.exec(
        "UPDATE relay_room SET title = ? WHERE singleton = 1",
        message.title,
      );
      this.broadcast({ type: "room", room: this.getRoom() });
      this.send(socket, { type: "ack", requestID: message.requestID });
      return;
    }

    if (message.type === "agent.pause") {
      const room = this.getRoom();
      if (room.opencodeSessionID) {
        await this.runner
          .interrupt(room.id, room.opencodeSessionID)
          .catch(() => undefined);
      }
      this.setRoomStatus("paused");
      return;
    }

    const isFirstPrompt = this.countPromptEvents() === 0;
    const event = this.insertEvent({
      id: crypto.randomUUID(),
      kind: "prompt",
      createdAt: Date.now(),
      actor: participant,
      payload: {
        text: message.text,
        delivery: message.delivery,
        ...(message.delivery === "queue" ? { queueStatus: "pending" } : {}),
      },
    });
    this.broadcast({ type: "event", event });
    this.send(socket, { type: "ack", requestID: message.requestID });

    if (isFirstPrompt) this.setRoomTitle(deriveThreadTitle(message.text));

    const configurationError = liveOpenCodeConfigurationError(this.env);
    if (configurationError) {
      this.setRoomStatus("error");
      const unavailable = this.insertEvent({
        id: crypto.randomUUID(),
        kind: "opencode",
        createdAt: Date.now(),
        payload: {
          type: "text",
          text: `Agent unavailable: ${configurationError}`,
        },
      });
      this.broadcast({ type: "event", event: unavailable });
      return;
    }

    if (!hasLiveOpenCode(this.env)) {
      if (
        message.delivery === "queue" &&
        this.getRoom().agentStatus === "running"
      )
        return;
      const generation = this.beginAgentTurn();
      try {
        if (message.delivery === "queue") this.consumeQueuedPrompt(event.id);
        await this.runSimulatedTurn(message.text);
        await this.drainSimulatedQueue();
        this.completeAgentTurn(generation, "idle");
      } catch (error) {
        this.completeAgentTurn(generation, "error");
        throw error;
      }
      return;
    }

    const generation = this.beginAgentTurn();
    try {
      const result = await this.runNativeOpenCodeTurn(
        message.text,
        message.delivery,
        message.delivery === "queue" ? event.id : undefined,
        generation,
      );
      this.completeAgentTurn(
        generation,
        result === "succeeded"
          ? "idle"
          : result === "interrupted"
            ? "paused"
            : "error",
      );
    } catch (error) {
      this.completeAgentTurn(generation, "error");
      const failed = this.insertEvent({
        id: crypto.randomUUID(),
        kind: "system",
        createdAt: Date.now(),
        payload: {
          type: "runner_error",
          text: `Agent turn failed: ${error instanceof Error ? error.message : "Unknown runner error"}`,
        },
      });
      this.broadcast({ type: "event", event: failed });
      throw error;
    }
  }

  private async runSimulatedTurn(prompt: string) {
    const searchTerm = extractSearchTerm(prompt);
    const workspace = await this.workspace.ensureReady();
    const searchOutput = await this.workspace.search(searchTerm);
    const diffOutput = await this.workspace.diff();
    const workspaceKind = workspace.directory.startsWith("github://")
      ? "Workers-native GitHub snapshot"
      : "Cloudflare Sandbox";
    const sequence: Array<{ delay: number; payload: Record<string, unknown> }> =
      [
        {
          delay: 180,
          payload: {
            type: "reasoning",
            text: `I’ll inspect ${workspace.repository}@${workspace.commitSHA.slice(0, 8)} for ${searchTerm}, then read the shared Git diff.`,
          },
        },
        {
          delay: 260,
          payload: {
            type: "tool",
            tool: "bash",
            status: "running",
            summary: "Searching the repository…",
          },
        },
        {
          delay: 320,
          payload: {
            type: "tool",
            tool: "bash",
            status: "completed",
            summary:
              searchOutput === "No matches found."
                ? "No matches"
                : "Repository search completed",
            output: searchOutput,
          },
        },
        {
          delay: 280,
          payload: {
            type: "tool",
            tool: "bash",
            status: "completed",
            summary: "Shared Git diff inspected",
            output: diffOutput,
          },
        },
        {
          delay: 240,
          payload: {
            type: "text",
            text: `I inspected the real workspace pinned at ${workspace.commitSHA.slice(0, 12)}. The search and diff transcripts above came from the ${workspaceKind}; no repository files were changed.`,
          },
        },
      ];

    for (const step of sequence) {
      await wait(step.delay);
      const event = this.insertEvent({
        id: crypto.randomUUID(),
        kind: "opencode",
        createdAt: Date.now(),
        payload: step.payload,
      });
      this.broadcast({ type: "event", event });
    }
  }

  private async drainSimulatedQueue() {
    while (true) {
      const next = this.getQueue()[0];
      if (!next) return;
      this.consumeQueuedPrompt(next.eventID);
      await this.runSimulatedTurn(next.text);
    }
  }

  private async runNativeOpenCodeTurn(
    prompt: string,
    delivery: "steer" | "queue",
    queuedPromptID: string | undefined,
    generation: number,
  ): Promise<"succeeded" | "failed" | "interrupted"> {
    const room = this.getRoom();
    const workspace = await this.workspace.nativeAgentWorkspace();
    let queueConsumed = false;
    const result = await this.runner.turn(
      {
        roomID: room.id,
        repository: workspace.repository,
        commitSHA: workspace.commitSHA,
        changes: workspace.changes,
        prompt,
        delivery,
        model: this.env.OPENCODE_MODEL,
        sessionID: room.opencodeSessionID,
        after: this.openCodeCursor(),
      },
      (event) => {
        if (!queueConsumed && queuedPromptID) {
          queueConsumed = true;
          this.consumeQueuedPrompt(queuedPromptID);
          this.setAgentTurnStatus(generation, "running");
        }
        this.handleNativeRunnerEvent(event);
      },
    );
    this.ctx.storage.sql.exec(
      "UPDATE relay_room SET opencode_session_id = ?, opencode_event_cursor = ? WHERE singleton = 1",
      result.sessionID,
      result.cursor ?? null,
    );
    this.workspace.syncNativeAgentChanges(result.changes);
    const workspaceChanged =
      JSON.stringify(workspace.changes) !== JSON.stringify(result.changes);
    if (result.status === "succeeded" && workspaceChanged) {
      this.ctx.storage.sql.exec(
        "UPDATE relay_room SET workspace_revision = workspace_revision + 1 WHERE singleton = 1",
      );
    }
    if (result.status === "succeeded" && workspaceChanged) {
      await this.publishSavedPullRequest();
    }
    return result.status;
  }

  private handleNativeRunnerEvent(event: NativeRunnerEvent) {
    if (event.type === "status") {
      const status = this.insertEvent({
        id: crypto.randomUUID(),
        kind: "system",
        createdAt: Date.now(),
        payload: { type: "runner_status", text: event.message },
      });
      this.broadcast({ type: "event", event: status });
      return;
    }
    if (event.type === "session") {
      this.ctx.storage.sql.exec(
        "UPDATE relay_room SET opencode_session_id = ? WHERE singleton = 1",
        event.sessionID,
      );
      return;
    }
    if (event.type !== "opencode") return;
    if (event.cursor)
      this.ctx.storage.sql.exec(
        "UPDATE relay_room SET opencode_event_cursor = ? WHERE singleton = 1",
        event.cursor,
      );
    const eventRecord = normalizeNativeEvent(unwrapNativeEvent(event.event));
    const data = asRecord(eventRecord.data);
    this.captureOpenCodePermission(eventRecord, data);
    const timelineEvent = this.insertEvent({
      id:
        typeof eventRecord.id === "string"
          ? eventRecord.id
          : event.cursor
            ? `opencode:${this.roomID}:${event.cursor}`
            : crypto.randomUUID(),
      kind: "opencode",
      createdAt:
        typeof eventRecord.created === "number" ? eventRecord.created : Date.now(),
      payload: { type: "raw", event: eventRecord },
    });
    this.broadcast({ type: "event", event: timelineEvent });
  }

  private openCodeCursor(): string | undefined {
    return (
      this.ctx.storage.sql
        .exec<{ opencode_event_cursor: string | null }>(
          "SELECT opencode_event_cursor FROM relay_room WHERE singleton = 1",
        )
        .one().opencode_event_cursor ?? undefined
    );
  }

  private captureOpenCodePermission(
    event: Record<string, unknown>,
    data: Record<string, unknown>,
  ) {
    if (event.type === "permission.asked" && typeof data.id === "string") {
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO relay_permissions (id, session_id, action, resources_json, message, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        data.id,
        String(data.sessionID ?? ""),
        String(data.action ?? "Side effect"),
        JSON.stringify(Array.isArray(data.resources) ? data.resources : []),
        typeof data.message === "string" ? data.message : null,
        "pending",
        Date.now(),
      );
      this.broadcast({
        type: "permissions",
        permissions: this.getPermissions(),
      });
    }
    if (
      event.type === "permission.replied" &&
      typeof data.requestID === "string"
    ) {
      this.ctx.storage.sql.exec(
        "UPDATE relay_permissions SET status = ? WHERE id = ?",
        data.reply === "reject" ? "denied" : "approved",
        data.requestID,
      );
      this.broadcast({
        type: "permissions",
        permissions: this.getPermissions(),
      });
    }
  }

  private async replyToPermission(
    requestID: string,
    reply: "once" | "always" | "reject",
    participant: SocketAttachment["participant"],
  ) {
    const permission = this.ctx.storage.sql
      .exec<PermissionRow>(
        "SELECT * FROM relay_permissions WHERE id = ?",
        requestID,
      )
      .toArray()[0];
    if (!permission || permission.status !== "pending")
      throw new Error("Permission request is no longer pending");

    const status = reply === "reject" ? "denied" : "approved";
    this.ctx.storage.sql.exec(
      "UPDATE relay_permissions SET status = ? WHERE id = ?",
      status,
      requestID,
    );
    const event = this.insertEvent({
      id: crypto.randomUUID(),
      kind: "permission",
      createdAt: Date.now(),
      actor: participant,
      payload: { requestID, action: permission.action, status, reply },
    });
    this.broadcast({ type: "event", event });
    this.broadcast({ type: "permissions", permissions: this.getPermissions() });
  }

  private insertEvent(
    event: Omit<TimelineEvent, "seq">,
    ignoreDuplicate = true,
  ): TimelineEvent {
    const insert = ignoreDuplicate ? "INSERT OR IGNORE" : "INSERT";
    const queueStatus =
      event.kind === "prompt" && event.payload.delivery === "queue"
        ? "pending"
        : null;
    this.ctx.storage.sql.exec(
      `${insert} INTO relay_events (id, kind, created_at, actor_json, payload_json, queue_status) VALUES (?, ?, ?, ?, ?, ?)`,
      event.id,
      event.kind,
      event.createdAt,
      event.actor ? JSON.stringify(event.actor) : null,
      JSON.stringify(event.payload),
      queueStatus,
    );
    const row = this.ctx.storage.sql
      .exec<EventRow>("SELECT * FROM relay_events WHERE id = ?", event.id)
      .one();
    return this.rowToEvent(row);
  }

  private getEvents(): TimelineEvent[] {
    return this.ctx.storage.sql
      .exec<EventRow>(
        "SELECT * FROM (SELECT * FROM relay_events ORDER BY seq DESC LIMIT 500) ORDER BY seq ASC",
      )
      .toArray()
      .map((row) => this.rowToEvent(row));
  }

  private rowToEvent(row: EventRow): TimelineEvent {
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    if (row.kind === "prompt" && payload.delivery === "queue") {
      payload.queueStatus = row.queue_status ?? "consumed";
    }
    return {
      seq: row.seq,
      id: row.id,
      kind: row.kind,
      createdAt: row.created_at,
      actor: row.actor_json ? JSON.parse(row.actor_json) : undefined,
      payload,
    };
  }

  private upsertParticipant(
    participant: Pick<Participant, "id" | "name" | "role" | "color">,
    lastSeen = Date.now(),
  ) {
    this.ctx.storage.sql.exec(
      "INSERT INTO relay_participants (id, name, role, color, last_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, color = excluded.color, last_seen = excluded.last_seen",
      participant.id,
      participant.name,
      participant.role,
      participant.color,
      lastSeen,
    );
  }

  private getParticipants(): Participant[] {
    const onlineIDs = new Set(
      this.ctx.getWebSockets().flatMap((socket) => {
        const attachment =
          socket.deserializeAttachment() as SocketAttachment | null;
        return attachment ? [attachment.participant.id] : [];
      }),
    );
    return this.ctx.storage.sql
      .exec<ParticipantRow>(
        "SELECT * FROM relay_participants ORDER BY last_seen DESC",
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role,
        color: row.color,
        lastSeen: row.last_seen,
        online: onlineIDs.has(row.id),
      }));
  }

  private getPermissions(): PermissionRequest[] {
    return this.ctx.storage.sql
      .exec<PermissionRow>(
        "SELECT * FROM relay_permissions ORDER BY created_at DESC",
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        sessionID: row.session_id,
        action: row.action,
        resources: JSON.parse(row.resources_json),
        message: row.message ?? undefined,
        status: row.status,
        createdAt: row.created_at,
      }));
  }

  private getQueue(): QueuedPrompt[] {
    const events = this.ctx.storage.sql
      .exec<EventRow>(
        "SELECT * FROM relay_events WHERE kind = 'prompt' AND queue_status = 'pending' ORDER BY seq ASC",
      )
      .toArray()
      .map((row) => this.rowToEvent(row));
    return queuedPrompts(events);
  }

  private consumeQueuedPrompt(eventID: string) {
    this.ctx.storage.sql.exec(
      "UPDATE relay_events SET queue_status = 'consumed' WHERE id = ? AND queue_status = 'pending'",
      eventID,
    );
    const rows = this.ctx.storage.sql
      .exec<EventRow>("SELECT * FROM relay_events WHERE id = ?", eventID)
      .toArray();
    if (rows.length) {
      this.broadcast({ type: "event", event: this.rowToEvent(rows[0]) });
    }
  }

  private insertRevision(input: {
    workspaceRevision: number;
    commitSHA: string;
    status: RoomRevision["status"];
    previewURL?: string;
    provider?: string;
  }): RoomRevision {
    const now = Date.now();
    const sequence = this.ctx.storage.sql
      .exec<{ sequence: number }>(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM relay_revisions",
      )
      .one().sequence;
    const id = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      "INSERT INTO relay_revisions (id, sequence, workspace_revision, commit_sha, status, preview_url, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      sequence,
      input.workspaceRevision,
      input.commitSHA,
      input.status,
      input.previewURL ?? null,
      input.provider ?? null,
      now,
      now,
    );
    return this.revisionByID(id)!;
  }

  private revisionByID(id: string): RoomRevision | undefined {
    const row = this.ctx.storage.sql
      .exec<RevisionRow>("SELECT * FROM relay_revisions WHERE id = ?", id)
      .toArray()[0];
    return row ? this.rowToRevision(row) : undefined;
  }

  private revisionForCommit(commitSHA: string): RoomRevision | undefined {
    const row = this.ctx.storage.sql
      .exec<RevisionRow>(
        "SELECT * FROM relay_revisions WHERE commit_sha = ?",
        commitSHA,
      )
      .toArray()[0];
    return row ? this.rowToRevision(row) : undefined;
  }

  private latestRevision(): RoomRevision | undefined {
    const row = this.ctx.storage.sql
      .exec<RevisionRow>(
        "SELECT * FROM relay_revisions ORDER BY sequence DESC LIMIT 1",
      )
      .toArray()[0];
    return row ? this.rowToRevision(row) : undefined;
  }

  private activeRevision(): RoomRevision | undefined {
    const row = this.ctx.storage.sql
      .exec<RevisionRow>(
        "SELECT * FROM relay_revisions WHERE activated_at IS NOT NULL ORDER BY activated_at DESC LIMIT 1",
      )
      .toArray()[0];
    return row ? this.rowToRevision(row) : undefined;
  }

  private rowToRevision(row: RevisionRow): RoomRevision {
    return {
      id: row.id,
      sequence: row.sequence,
      workspaceRevision: row.workspace_revision,
      commitSHA: row.commit_sha,
      status: row.status,
      previewURL: row.preview_url ?? undefined,
      provider: row.provider ?? undefined,
      deploymentID: row.deployment_id ?? undefined,
      failure: row.failure ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      activatedAt: row.activated_at ?? undefined,
    };
  }

  private githubCredential(): string | undefined {
    return (
      this.ctx.storage.sql
        .exec<{ github_credential: string | null }>(
          "SELECT github_credential FROM relay_room WHERE singleton = 1",
        )
        .one().github_credential ?? undefined
    );
  }

  private getRoomOrNull(): RoomInfo | null {
    const rows = this.ctx.storage.sql
      .exec<{
        room_id: string;
        title: string;
        repository: string;
        branch: string;
        agent_status: RoomInfo["agentStatus"];
        opencode_session_id: string | null;
        commit_sha: string | null;
        workspace_status: RoomInfo["workspaceStatus"];
        workspace_error: string | null;
        pull_request_url: string | null;
        pull_request_number: number | null;
        pull_request_branch: string | null;
        pull_request_repository: string | null;
        pull_request_head_sha: string | null;
        workspace_revision: number;
        published_workspace_revision: number;
        github_credential: string | null;
      }>("SELECT * FROM relay_room WHERE singleton = 1")
      .toArray();
    if (!rows.length) return null;
    const row = rows[0];
    return {
      id: row.room_id,
      title: row.title,
      repository: row.repository,
      branch: row.branch,
      commitSHA: row.commit_sha ?? undefined,
      workspaceStatus: row.workspace_status,
      workspaceError: row.workspace_error ?? undefined,
      agentStatus: row.agent_status,
      opencodeSessionID: row.opencode_session_id ?? undefined,
      workspaceRevision: row.workspace_revision,
      publishedWorkspaceRevision: row.published_workspace_revision,
      pullRequestURL: row.pull_request_url ?? undefined,
      pullRequestNumber: row.pull_request_number ?? undefined,
      pullRequestBranch: row.pull_request_branch ?? undefined,
      pullRequestRepository: row.pull_request_repository ?? undefined,
      pullRequestHeadSHA: row.pull_request_head_sha ?? undefined,
      autoPublishConfigured: Boolean(row.github_credential),
      latestRevision: this.latestRevision(),
      activeRevision: this.activeRevision(),
    };
  }

  private getRoom(): RoomInfo {
    const room = this.getRoomOrNull();
    if (!room) throw new Error("Room has not been initialized");
    return room;
  }

  private setRoomStatus(status: RoomInfo["agentStatus"]) {
    this.ctx.storage.sql.exec(
      "UPDATE relay_room SET agent_status = ? WHERE singleton = 1",
      status,
    );
    this.broadcast({ type: "room", room: this.getRoom() });
  }

  private setRoomTitle(title: string) {
    this.ctx.storage.sql.exec(
      "UPDATE relay_room SET title = ? WHERE singleton = 1",
      title,
    );
    this.broadcast({ type: "room", room: this.getRoom() });
  }

  private countPromptEvents(): number {
    return this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM relay_events WHERE kind = 'prompt'",
      )
      .one().count;
  }

  private beginAgentTurn(): number {
    this.ctx.storage.sql.exec(
      "UPDATE relay_room SET agent_turn_generation = agent_turn_generation + 1, agent_status = 'running' WHERE singleton = 1",
    );
    const generation = this.ctx.storage.sql
      .exec<{ agent_turn_generation: number }>(
        "SELECT agent_turn_generation FROM relay_room WHERE singleton = 1",
      )
      .one().agent_turn_generation;
    this.broadcast({ type: "room", room: this.getRoom() });
    return generation;
  }

  private completeAgentTurn(
    generation: number,
    status: RoomInfo["agentStatus"],
  ) {
    const currentGeneration = this.ctx.storage.sql
      .exec<{ agent_turn_generation: number }>(
        "SELECT agent_turn_generation FROM relay_room WHERE singleton = 1",
      )
      .one().agent_turn_generation;
    const completedStatus = completedTurnStatus(
      currentGeneration,
      generation,
      status,
    );
    if (completedStatus) this.setRoomStatus(completedStatus);
  }

  private setAgentTurnStatus(
    generation: number,
    status: RoomInfo["agentStatus"],
  ) {
    const currentGeneration = this.ctx.storage.sql
      .exec<{ agent_turn_generation: number }>(
        "SELECT agent_turn_generation FROM relay_room WHERE singleton = 1",
      )
      .one().agent_turn_generation;
    if (currentGeneration === generation) this.setRoomStatus(status);
  }

  private async snapshot(): Promise<RoomSnapshot> {
    const events = this.getEvents();
    return {
      type: "snapshot",
      room: this.getRoom(),
      participants: this.getParticipants(),
      events,
      permissions: this.getPermissions(),
      queue: this.getQueue(),
    };
  }

  private broadcastPresence() {
    this.broadcast({ type: "presence", participants: this.getParticipants() });
  }

  private broadcast(message: ServerMessage) {
    const serialized = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(serialized);
      } catch {
        // The hibernation API owns cleanup for closed sockets.
      }
    }
  }

  private send(socket: WebSocket, message: ServerMessage) {
    socket.send(JSON.stringify(message));
  }
}

function hashCode(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1)
    hash = (hash << 5) - hash + value.charCodeAt(index);
  return hash | 0;
}

function validatePreviewURL(value: string): string {
  const url = new URL(value);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw new Error("Preview URL must use HTTPS unless it is local");
  url.username = "";
  url.password = "";
  url.hash = "";
  return url.toString();
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function validateHandoffClientState(
  value: HandoffClientState | undefined,
): HandoffClientState | undefined {
  if (!value) return undefined;
  const draft =
    typeof value.draft === "string"
      ? value.draft.slice(0, 8_000)
      : undefined;
  const selectedID =
    typeof value.selectedID === "string"
      ? value.selectedID.slice(0, 200)
      : undefined;
  const mobileTab =
    value.mobileTab === "people" || value.mobileTab === "queue"
      ? value.mobileTab
      : "transcript";
  return { draft, selectedID, mobileTab };
}

async function verifyReadyPreview(previewURL: string, commitSHA: string) {
  const readiness = new URL("/__relay/ready", validatePreviewURL(previewURL));
  const response = await fetch(readiness, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  const result: { ready?: boolean; commitSHA?: string; roomProtocol?: number } =
    await response
    .json<{ ready?: boolean; commitSHA?: string; roomProtocol?: number }>()
    .catch(() => ({}));
  if (
    !response.ok ||
    !result.ready ||
    result.commitSHA !== commitSHA ||
    result.roomProtocol !== 1
  ) {
    throw new Error("Deployment did not pass the Relay readiness check");
  }
}

function unwrapNativeEvent(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const nested = asRecord(value.event);
  return typeof value.type === "string" || !Object.keys(nested).length
    ? value
    : nested;
}

function normalizeNativeEvent(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const type = typeof value.type === "string" ? value.type : "";
  return type.startsWith("session.next.")
    ? { ...value, type: type.replace("session.next.", "session.") }
    : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function deriveThreadTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 100) return collapsed;
  return `${collapsed.slice(0, 99).trimEnd()}…`;
}

function cleanPullRequestText(
  value: string | undefined,
  fallback: string,
  maximum: number,
): string {
  const normalized = value?.trim() || fallback;
  if (!normalized || normalized.length > maximum || normalized.includes("\0")) {
    throw new Error(
      `Pull request text must be between 1 and ${maximum.toLocaleString()} characters`,
    );
  }
  return normalized;
}

function extractSearchTerm(prompt: string): string {
  const tokens = prompt.match(/[A-Za-z_$][\w$.-]{2,}/g) ?? [];
  const stopwords = new Set([
    "agent",
    "and",
    "are",
    "can",
    "check",
    "cite",
    "code",
    "does",
    "files",
    "find",
    "for",
    "from",
    "how",
    "implemented",
    "implementation",
    "investigate",
    "look",
    "real",
    "repository",
    "show",
    "the",
    "this",
    "where",
    "with",
  ]);

  return (
    tokens.find(
      (token) => /[A-Z].*[A-Z]/.test(token) || /[_.$-]/.test(token),
    ) ??
    tokens.find((token) => !stopwords.has(token.toLowerCase())) ??
    "WebSocket"
  );
}
