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

export type DeploymentStatus = "waiting" | "building" | "ready" | "failed";

export interface RoomRevision {
  id: string;
  sequence: number;
  workspaceRevision: number;
  commitSHA: string;
  status: DeploymentStatus;
  previewURL?: string;
  provider?: string;
  deploymentID?: string;
  failure?: string;
  createdAt: number;
  updatedAt: number;
  activatedAt?: number;
}

export interface RoomInfo {
  id: string;
  title: string;
  titleAuto: boolean;
  repository: string;
  branch: string;
  commitSHA?: string;
  workspaceStatus: "cloning" | "ready" | "error";
  workspaceError?: string;
  agentStatus: "idle" | "running" | "paused" | "error";
  model: string;
  opencodeSessionID?: string;
  workspaceRevision: number;
  publishedWorkspaceRevision: number;
  pullRequestURL?: string;
  pullRequestNumber?: number;
  pullRequestBranch?: string;
  pullRequestRepository?: string;
  pullRequestHeadSHA?: string;
  autoPublishConfigured: boolean;
  latestRevision?: RoomRevision;
  activeRevision?: RoomRevision;
}

export interface OpenCodeModelOption {
  id: string;
  name: string;
  providerID: string;
  free: boolean;
}

export interface TimelineEvent {
  seq: number;
  id: string;
  kind: "participant" | "prompt" | "opencode" | "permission" | "system";
  createdAt: number;
  actor?: Pick<Participant, "id" | "name" | "role" | "color">;
  payload: Record<string, unknown>;
}

export function queuedPrompts(events: TimelineEvent[]): QueuedPrompt[] {
  return events
    .filter(
      (event) =>
        event.kind === "prompt" &&
        event.payload.delivery === "queue" &&
        event.payload.queueStatus === "pending" &&
        event.actor,
    )
    .map((event) => ({
      eventID: event.id,
      participant: event.actor!,
      text: String(event.payload.text ?? ""),
      createdAt: event.createdAt,
    }));
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

export type BriefReviewStatus = "draft" | "in_review" | "approved" | "changes_requested";

export interface BriefReview {
  status: BriefReviewStatus;
  round: number;
  startedAt?: number;
  startedBy?: Pick<Participant, "id" | "name" | "color">;
  resolvedAt?: number;
  resolvedBy?: Pick<Participant, "id" | "name" | "color">;
}

export interface BriefReviewComment {
  id: string;
  round: number;
  text: string;
  actor: Pick<Participant, "id" | "name" | "role" | "color">;
  createdAt: number;
}

export interface ImplementationBrief {
  objective: string;
  constraints: string[];
  validation: string[];
  revision: number;
  review: BriefReview;
  reviewComments: BriefReviewComment[];
  updatedAt?: number;
  updatedBy?: Pick<Participant, "id" | "name" | "color">;
}

export interface RoomDecision {
  id: string;
  text: string;
  rationale?: string;
  sourceEventID?: string;
  actor: Pick<Participant, "id" | "name" | "role" | "color">;
  createdAt: number;
}

export interface RoomSnapshot {
  type: "snapshot";
  room: RoomInfo;
  models: OpenCodeModelOption[];
  participants: Participant[];
  events: TimelineEvent[];
  permissions: PermissionRequest[];
  queue: QueuedPrompt[];
  brief: ImplementationBrief;
  decisions: RoomDecision[];
}

export type ServerMessage =
  | RoomSnapshot
  | { type: "event"; event: TimelineEvent }
  | { type: "presence"; participants: Participant[] }
  | { type: "room"; room: RoomInfo }
  | { type: "permissions"; permissions: PermissionRequest[] }
  | {
      type: "planning";
      brief: ImplementationBrief;
      decisions: RoomDecision[];
    }
  | { type: "ack"; requestID?: string }
  | { type: "error"; message: string; requestID?: string };

export type ClientMessage =
  | { type: "prompt"; text: string; delivery: DeliveryMode; requestID?: string }
  | {
      type: "question.reply";
      sessionID: string;
      formID: string;
      answer: Record<string, string | string[]>;
      requestID?: string;
    }
  | {
      type: "question.cancel";
      sessionID: string;
      formID: string;
      requestID?: string;
    }
  | { type: "room.rename"; title: string; requestID?: string }
  | { type: "room.model.configure"; model: string; requestID?: string }
  | {
      type: "permission.reply";
      requestID: string;
      reply: "once" | "always" | "reject";
    }
  | { type: "agent.pause" }
  | {
      type: "brief.update";
      objective: string;
      constraints: string[];
      validation: string[];
      requestID?: string;
    }
  | {
      type: "decision.create";
      text: string;
      rationale?: string;
      sourceEventID?: string;
      requestID?: string;
    }
  | { type: "brief.review.start"; requestID?: string }
  | { type: "brief.review.comment"; text: string; requestID?: string }
  | {
      type: "brief.review.resolve";
      outcome: "approved" | "changes_requested";
      comment?: string;
      requestID?: string;
    }
  | {
      type: "room.configure";
      repository: string;
      branch: string;
      requestID?: string;
    }
  | { type: "ping" };

export const PARTICIPANT_COLORS = ["#a978e8", "#3f9c70", "#488dcc", "#d88952", "#c46a82"];

export function safeRoomID(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-");
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
    if (!text || text.length > 8_000)
      throw new Error("Prompt must be between 1 and 8,000 characters");
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
    return {
      type: "permission.reply",
      requestID: message.requestID,
      reply: message.reply,
    };
  }
  if (message.type === "question.reply") {
    const sessionID = parseQuestionIdentifier(message.sessionID, "session");
    const formID = parseQuestionIdentifier(message.formID, "form");
    if (!message.answer || typeof message.answer !== "object")
      throw new Error("Question answer is required");
    const entries = Object.entries(message.answer);
    if (entries.length > 20) throw new Error("Question answer is too large");
    const answer: Record<string, string | string[]> = {};
    for (const [key, raw] of entries) {
      if (!/^q\d+$/.test(key)) throw new Error("Invalid question field");
      const values = Array.isArray(raw) ? raw : [raw];
      if (
        values.length > 20 ||
        values.some((item) => typeof item !== "string" || item.length > 2_000)
      )
        throw new Error("Invalid question answer");
      answer[key] = Array.isArray(raw) ? (values as string[]) : values[0];
    }
    return {
      type: "question.reply",
      sessionID,
      formID,
      answer,
      requestID: typeof message.requestID === "string" ? message.requestID : undefined,
    };
  }
  if (message.type === "question.cancel") {
    return {
      type: "question.cancel",
      sessionID: parseQuestionIdentifier(message.sessionID, "session"),
      formID: parseQuestionIdentifier(message.formID, "form"),
      requestID: typeof message.requestID === "string" ? message.requestID : undefined,
    };
  }
  if (message.type === "room.rename") {
    const title = typeof message.title === "string" ? message.title.trim() : "";
    if (!title || title.length > 100 || title.includes("\0")) {
      throw new Error("Room title must be between 1 and 100 characters");
    }
    return {
      type: "room.rename",
      title,
      requestID: typeof message.requestID === "string" ? message.requestID : undefined,
    };
  }
  if (message.type === "room.model.configure") {
    const model = typeof message.model === "string" ? message.model.trim() : "";
    if (!model || model.length > 200 || model.includes("\0") || !model.includes("/")) {
      throw new Error("Choose a valid OpenCode model");
    }
    return {
      type: "room.model.configure",
      model,
      requestID: typeof message.requestID === "string" ? message.requestID : undefined,
    };
  }
  if (message.type === "agent.pause") return { type: "agent.pause" };
  if (message.type === "brief.update") {
    return {
      type: "brief.update",
      objective: parsePlanningText(message.objective, "objective", 4_000),
      constraints: parsePlanningList(message.constraints, "constraints"),
      validation: parsePlanningList(message.validation, "validation checks"),
      requestID: typeof message.requestID === "string" ? message.requestID : undefined,
    };
  }
  if (message.type === "decision.create") {
    const text = parsePlanningText(message.text, "decision", 2_000, true);
    const rationale = parsePlanningText(message.rationale, "decision rationale", 4_000);
    const sourceEventID =
      typeof message.sourceEventID === "string" && message.sourceEventID.length <= 200
        ? message.sourceEventID
        : undefined;
    return {
      type: "decision.create",
      text,
      rationale: rationale || undefined,
      sourceEventID,
      requestID: typeof message.requestID === "string" ? message.requestID : undefined,
    };
  }
  if (message.type === "brief.review.start") {
    return {
      type: "brief.review.start",
      requestID: typeof message.requestID === "string" ? message.requestID : undefined,
    };
  }
  if (message.type === "brief.review.comment") {
    return {
      type: "brief.review.comment",
      text: parsePlanningText(message.text, "review comment", 4_000, true),
      requestID: typeof message.requestID === "string" ? message.requestID : undefined,
    };
  }
  if (message.type === "brief.review.resolve") {
    if (message.outcome !== "approved" && message.outcome !== "changes_requested")
      throw new Error("Choose a valid review outcome");
    const comment = parsePlanningText(message.comment, "review comment", 4_000);
    if (message.outcome === "changes_requested" && !comment)
      throw new Error("Describe the changes you are requesting");
    return {
      type: "brief.review.resolve",
      outcome: message.outcome,
      comment: comment || undefined,
      requestID: typeof message.requestID === "string" ? message.requestID : undefined,
    };
  }
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

function parsePlanningText(value: unknown, label: string, maximum: number, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if ((required && !text) || text.length > maximum || text.includes("\0"))
    throw new Error(
      required
        ? `${label} must be between 1 and ${maximum.toLocaleString()} characters`
        : `${label} must be no more than ${maximum.toLocaleString()} characters`,
    );
  return text;
}

function parsePlanningList(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > 30) throw new Error(`Brief ${label} are invalid`);
  return value.map((item) => {
    const text = parsePlanningText(item, label, 1_000, true);
    return text;
  });
}

function parseQuestionIdentifier(value: unknown, label: string) {
  if (typeof value !== "string" || !value || value.length > 200 || value.includes("\0"))
    throw new Error(`Invalid question ${label} ID`);
  return value;
}
