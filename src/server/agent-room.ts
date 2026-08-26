import { DurableObject } from "cloudflare:workers";
import type { OpenCodeWorkerd } from "@opencode-ai/sdk/workerd";
import {
  DEFAULT_BRANCH,
  DEFAULT_REPOSITORY,
  PARTICIPANT_COLORS,
  parseClientMessage,
  type ClientMessage,
  type Participant,
  type PermissionRequest,
  type QueuedPrompt,
  type RoomInfo,
  type RoomSnapshot,
  type ServerMessage,
  type TimelineEvent,
} from "../shared/protocol";
import { createOpenCode, hasLiveOpenCode, type WorkerEnv } from "./opencode";
import { RepositoryWorkspace } from "./workspace";
import {
  GitHubPullRequestClient,
  type PullRequestResult,
} from "./github-pull-request";

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

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class AgentRoom extends DurableObject<WorkerEnv> {
  private readonly opencode: Promise<OpenCodeWorkerd.Interface>;
  private readonly workspace: RepositoryWorkspace;
  private roomID = "reconnect-loop";
  private eventPumpStarted = false;

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    this.workspace = new RepositoryWorkspace(ctx.storage, env);
    this.opencode = ctx.blockConcurrencyWhile(async () => {
      const host = await createOpenCode(ctx.storage, env, this.workspace);
      this.migrate();
      this.startEventPump(host);
      return host;
    });
  }

  async initialize(roomID: string): Promise<void> {
    this.roomID = roomID;
    this.ensureRoom(roomID);
    await this.workspace.ensureReady().catch((error) => {
      console.warn("Repository workspace initialization deferred", error);
    });
    const room = this.getRoom();
    if (!room.opencodeSessionID) {
      try {
        const host = await this.opencode;
        const session = await host.sessions.create({
          title: room.title,
          agent: "build",
        });
        this.ctx.storage.sql.exec(
          "UPDATE relay_room SET opencode_session_id = ? WHERE singleton = 1",
          session.id,
        );
      } catch (error) {
        console.warn("OpenCode session initialization deferred", error);
      }
    }
  }

  async createPullRequest(input: {
    accessToken: string;
    login: string;
    title?: string;
    body?: string;
  }): Promise<PullRequestResult> {
    const room = this.getRoom();
    if (room.pullRequestURL)
      throw new Error(
        "This version of the shared workspace already has a pull request",
      );
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
    const result = await new GitHubPullRequestClient(input.accessToken).create({
      accessToken: input.accessToken,
      login: input.login,
      roomID: room.id,
      repository: workspace.repository,
      baseBranch: workspace.branch,
      baseCommitSHA: workspace.commitSHA,
      changes: workspace.changes,
      title,
      body,
    });
    this.ctx.storage.sql.exec(
      "UPDATE relay_room SET pull_request_url = ?, pull_request_branch = ? WHERE singleton = 1",
      result.url,
      result.branch,
    );
    const event = this.insertEvent({
      id: crypto.randomUUID(),
      kind: "system",
      createdAt: Date.now(),
      payload: {
        type: "pull_request",
        text: `@${input.login} created pull request #${result.number}`,
        url: result.url,
        branch: result.branch,
      },
    });
    this.broadcast({ type: "room", room: this.getRoom() });
    this.broadcast({ type: "event", event });
    return result;
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
        payload_json TEXT NOT NULL
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
      CREATE INDEX IF NOT EXISTS relay_events_created_idx ON relay_events(created_at);
    `);
    this.ensureColumn("relay_room", "commit_sha", "TEXT");
    this.ensureColumn(
      "relay_room",
      "workspace_status",
      "TEXT NOT NULL DEFAULT 'cloning'",
    );
    this.ensureColumn("relay_room", "workspace_error", "TEXT");
    this.ensureColumn("relay_room", "pull_request_url", "TEXT");
    this.ensureColumn("relay_room", "pull_request_branch", "TEXT");
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
        const host = await this.opencode;
        await host.sessions
          .interrupt({ sessionID: room.opencodeSessionID, continue: false })
          .catch(() => undefined);
      }
      this.setRoomStatus("paused");
      return;
    }

    const event = this.insertEvent({
      id: crypto.randomUUID(),
      kind: "prompt",
      createdAt: Date.now(),
      actor: participant,
      payload: { text: message.text, delivery: message.delivery },
    });
    this.broadcast({ type: "event", event });
    this.send(socket, { type: "ack", requestID: message.requestID });

    if (!hasLiveOpenCode(this.env)) {
      if (message.delivery === "queue") return;
      this.setRoomStatus("running");
      await this.runSimulatedTurn(message.text);
      return;
    }

    this.setRoomStatus("running");
    const room = this.getRoom();
    if (!room.opencodeSessionID)
      throw new Error("OpenCode session is not ready");
    const host = await this.opencode;
    await host.sessions.prompt({
      sessionID: room.opencodeSessionID,
      text: message.text,
      delivery: message.delivery,
      metadata: {
        relayParticipantID: participant.id,
        relayParticipantName: participant.name,
      },
    });
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
    this.setRoomStatus("idle");
  }

  private startEventPump(host: OpenCodeWorkerd.Interface) {
    if (this.eventPumpStarted) return;
    this.eventPumpStarted = true;
    void (async () => {
      try {
        for await (const rawEvent of host.events.subscribe()) {
          const eventRecord = rawEvent as unknown as Record<string, unknown>;
          const data = (eventRecord.data ?? {}) as Record<string, unknown>;
          const room = this.getRoomOrNull();
          if (
            !room?.opencodeSessionID ||
            data.sessionID !== room.opencodeSessionID
          )
            continue;
          this.captureOpenCodePermission(eventRecord, data);
          this.updateStatusFromOpenCode(eventRecord.type);
          const event = this.insertEvent({
            id:
              typeof eventRecord.id === "string"
                ? eventRecord.id
                : crypto.randomUUID(),
            kind: "opencode",
            createdAt:
              typeof eventRecord.created === "number"
                ? eventRecord.created
                : Date.now(),
            payload: { type: "raw", event: eventRecord },
          });
          this.broadcast({ type: "event", event });
        }
      } catch (error) {
        console.error("OpenCode event stream stopped", error);
        this.eventPumpStarted = false;
      }
    })();
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

  private updateStatusFromOpenCode(type: unknown) {
    if (type === "session.execution.started") this.setRoomStatus("running");
    if (type === "session.execution.succeeded") this.setRoomStatus("idle");
    if (type === "session.execution.interrupted") this.setRoomStatus("paused");
    if (type === "session.execution.failed") this.setRoomStatus("error");
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

    if (hasLiveOpenCode(this.env)) {
      const host = await this.opencode;
      await host.permission.reply({
        sessionID: permission.session_id,
        requestID,
        reply,
      });
    }
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
    this.ctx.storage.sql.exec(
      `${insert} INTO relay_events (id, kind, created_at, actor_json, payload_json) VALUES (?, ?, ?, ?, ?)`,
      event.id,
      event.kind,
      event.createdAt,
      event.actor ? JSON.stringify(event.actor) : null,
      JSON.stringify(event.payload),
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
    return {
      seq: row.seq,
      id: row.id,
      kind: row.kind,
      createdAt: row.created_at,
      actor: row.actor_json ? JSON.parse(row.actor_json) : undefined,
      payload: JSON.parse(row.payload_json),
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

  private getQueue(events = this.getEvents()): QueuedPrompt[] {
    return events
      .filter(
        (event) =>
          event.kind === "prompt" &&
          event.payload.delivery === "queue" &&
          event.actor,
      )
      .map((event) => ({
        eventID: event.id,
        participant: event.actor!,
        text: String(event.payload.text ?? ""),
        createdAt: event.createdAt,
      }));
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
        pull_request_branch: string | null;
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
      pullRequestURL: row.pull_request_url ?? undefined,
      pullRequestBranch: row.pull_request_branch ?? undefined,
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

  private async snapshot(): Promise<RoomSnapshot> {
    const events = this.getEvents();
    return {
      type: "snapshot",
      room: this.getRoom(),
      participants: this.getParticipants(),
      events,
      permissions: this.getPermissions(),
      queue: this.getQueue(events),
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
