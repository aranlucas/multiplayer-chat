export type ParticipantRole = "maintainer" | "contributor";

export const DEFAULT_REPOSITORY = "aranlucas/multiplayer-chat";
export const DEFAULT_BRANCH = "main";

export interface Participant {
  id: string;
  name: string;
  role: ParticipantRole;
  color: string;
  online: boolean;
  lastSeen: number;
}

export type DeliveryMode = "steer" | "queue";

export interface RoomInfo {
  id: string;
  title: string;
  repository: string;
  branch: string;
  commitSHA?: string;
  workspaceStatus: "cloning" | "ready" | "error";
  workspaceError?: string;
  agentStatus: "idle" | "running" | "paused" | "error";
  opencodeSessionID?: string;
  pullRequestURL?: string;
  pullRequestBranch?: string;
}

export interface TimelineEvent {
  seq: number;
  id: string;
  kind: "participant" | "prompt" | "opencode" | "permission" | "system";
  createdAt: number;
  actor?: Pick<Participant, "id" | "name" | "role" | "color">;
  payload: Record<string, unknown>;
}

export interface PermissionRequest {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  message?: string;
  status: "pending" | "approved" | "denied";
  createdAt: number;
}

export interface QueuedPrompt {
  eventID: string;
  participant: Pick<Participant, "id" | "name" | "color">;
  text: string;
  createdAt: number;
}

export interface RoomSnapshot {
  type: "snapshot";
  room: RoomInfo;
  participants: Participant[];
  events: TimelineEvent[];
  permissions: PermissionRequest[];
  queue: QueuedPrompt[];
}

export type ServerMessage =
  | RoomSnapshot
  | { type: "event"; event: TimelineEvent }
  | { type: "presence"; participants: Participant[] }
  | { type: "room"; room: RoomInfo }
  | { type: "permissions"; permissions: PermissionRequest[] }
  | { type: "ack"; requestID?: string }
  | { type: "error"; message: string; requestID?: string };

export type ClientMessage =
  | { type: "prompt"; text: string; delivery: DeliveryMode; requestID?: string }
  | {
      type: "permission.reply";
      requestID: string;
      reply: "once" | "always" | "reject";
    }
  | { type: "agent.pause" }
  | { type: "room.configure"; repository: string; branch: string; requestID?: string }
  | { type: "ping" };

export const PARTICIPANT_COLORS = ["#a978e8", "#3f9c70", "#488dcc", "#d88952", "#c46a82"];

export function safeRoomID(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-");
  return normalized.slice(0, 64) || "reconnect-loop";
}

export function safeParticipantName(value: string | null): string {
  const normalized = (value ?? "Guest").trim().replace(/[<>]/g, "");
  return normalized.slice(0, 32) || "Guest";
}

export function parseClientMessage(value: unknown): ClientMessage {
  if (!value || typeof value !== "object") throw new Error("Invalid message");
  const message = value as Record<string, unknown>;
  if (message.type === "prompt") {
    const text = typeof message.text === "string" ? message.text.trim() : "";
    if (!text || text.length > 8_000) throw new Error("Prompt must be between 1 and 8,000 characters");
    if (message.delivery !== "steer" && message.delivery !== "queue") {
      throw new Error("Invalid delivery mode");
    }
    return {
      type: "prompt",
      text,
      delivery: message.delivery,
      requestID: typeof message.requestID === "string" ? message.requestID : undefined,
    };
  }
  if (message.type === "permission.reply") {
    if (typeof message.requestID !== "string") throw new Error("Missing permission request ID");
    if (message.reply !== "once" && message.reply !== "always" && message.reply !== "reject") {
      throw new Error("Invalid permission reply");
    }
    return { type: "permission.reply", requestID: message.requestID, reply: message.reply };
  }
  if (message.type === "agent.pause") return { type: "agent.pause" };
  if (message.type === "room.configure") {
    const repository = typeof message.repository === "string" ? message.repository.trim() : "";
    const branch = typeof message.branch === "string" ? message.branch.trim() : "";
    if (!repository || repository.length > 200) throw new Error("Repository is required");
    if (!branch || branch.length > 200) throw new Error("Branch is required");
    return {
      type: "room.configure",
      repository,
      branch,
      requestID: typeof message.requestID === "string" ? message.requestID : undefined,
    };
  }
  if (message.type === "ping") return { type: "ping" };
  throw new Error("Unknown message type");
}
