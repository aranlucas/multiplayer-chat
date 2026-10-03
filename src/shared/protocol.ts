import { z } from "zod";
import { jsonRecordSchema, type JsonRecord } from "./json-value";
import { textValue } from "./text-value";

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
  payload: JsonRecord;
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
    .flatMap((event) =>
      event.actor
        ? [
            {
              eventID: event.id,
              participant: event.actor,
              text: textValue(event.payload.text ?? ""),
              createdAt: event.createdAt,
            },
          ]
        : [],
    );
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
      reply: "once" | "reject";
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

const requestIDSchema = z.string().optional().catch(undefined);

const questionIDSchema = (label: string) =>
  z
    .string({ error: `Invalid question ${label} ID` })
    .min(1, `Invalid question ${label} ID`)
    .max(200, `Invalid question ${label} ID`)
    .refine((value) => !value.includes("\0"), `Invalid question ${label} ID`);

function planningTextSchema(label: string, maximum: number, required = false) {
  const message = required
    ? `${label} must be between 1 and ${maximum.toLocaleString()} characters`
    : `${label} must be no more than ${maximum.toLocaleString()} characters`;

  return z
    .string()
    .catch("")
    .transform((value) => value.trim())
    .refine(
      (value) =>
        (!required || value.length > 0) && value.length <= maximum && !value.includes("\0"),
      message,
    );
}

function planningListSchema(label: string) {
  return z
    .array(planningTextSchema(label, 1_000, true), { error: `Brief ${label} are invalid` })
    .max(30, `Brief ${label} are invalid`);
}

const answerSchema = z
  .record(
    z.string().regex(/^q\d+$/, "Invalid question field"),
    z.union([z.string().max(2_000), z.array(z.string().max(2_000)).max(20)], {
      error: "Invalid question answer",
    }),
  )
  .refine((value) => Object.keys(value).length <= 20, "Question answer is too large");

const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("prompt"),
    text: z
      .string()
      .catch("")
      .transform((value) => value.trim())
      .refine(
        (value) => value.length > 0 && value.length <= 8_000,
        "Prompt must be between 1 and 8,000 characters",
      ),
    delivery: z.enum(["steer", "queue"], { error: "Invalid delivery mode" }),
    requestID: requestIDSchema,
  }),
  z.object({
    type: z.literal("permission.reply"),
    requestID: z.string({ error: "Missing permission request ID" }),
    reply: z.enum(["once", "reject"], { error: "Invalid permission reply" }),
  }),
  z.object({
    type: z.literal("question.reply"),
    sessionID: questionIDSchema("session"),
    formID: questionIDSchema("form"),
    answer: answerSchema,
    requestID: requestIDSchema,
  }),
  z.object({
    type: z.literal("question.cancel"),
    sessionID: questionIDSchema("session"),
    formID: questionIDSchema("form"),
    requestID: requestIDSchema,
  }),
  z.object({
    type: z.literal("room.rename"),
    title: planningTextSchema("Room title", 100, true),
    requestID: requestIDSchema,
  }),
  z.object({
    type: z.literal("room.model.configure"),
    model: z
      .string()
      .catch("")
      .transform((value) => value.trim())
      .refine(
        (value) =>
          value.length > 0 && value.length <= 200 && !value.includes("\0") && value.includes("/"),
        "Choose a valid OpenCode model",
      ),
    requestID: requestIDSchema,
  }),
  z.object({ type: z.literal("agent.pause") }),
  z.object({
    type: z.literal("brief.update"),
    objective: planningTextSchema("objective", 4_000),
    constraints: planningListSchema("constraints"),
    validation: planningListSchema("validation checks"),
    requestID: requestIDSchema,
  }),
  z.object({
    type: z.literal("decision.create"),
    text: planningTextSchema("decision", 2_000, true),
    rationale: planningTextSchema("decision rationale", 4_000).transform(
      (value) => value || undefined,
    ),
    sourceEventID: z.string().max(200).optional().catch(undefined),
    requestID: requestIDSchema,
  }),
  z.object({ type: z.literal("brief.review.start"), requestID: requestIDSchema }),
  z.object({
    type: z.literal("brief.review.comment"),
    text: planningTextSchema("review comment", 4_000, true),
    requestID: requestIDSchema,
  }),
  z
    .object({
      type: z.literal("brief.review.resolve"),
      outcome: z.enum(["approved", "changes_requested"], {
        error: "Choose a valid review outcome",
      }),
      comment: planningTextSchema("review comment", 4_000).transform((value) => value || undefined),
      requestID: requestIDSchema,
    })
    .refine(
      (value) => value.outcome !== "changes_requested" || Boolean(value.comment),
      "Describe the changes you are requesting",
    ),
  z.object({
    type: z.literal("room.configure"),
    repository: z
      .string()
      .trim()
      .min(1, "Repository is required")
      .max(200, "Repository is required"),
    branch: z.string().trim().min(1, "Branch is required").max(200, "Branch is required"),
    requestID: requestIDSchema,
  }),
  z.object({ type: z.literal("ping") }),
]);

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- WebSocket JSON enters here and is validated against the complete discriminated wire contract.
export function parseClientMessage(value: unknown): ClientMessage {
  return clientMessageSchema.parse(value);
}

export const actorSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(["maintainer", "contributor"]),
  color: z.string(),
});

const participantSchema = actorSchema.extend({ online: z.boolean(), lastSeen: z.number() });

const revisionSchema = z.object({
  id: z.string(),
  sequence: z.number(),
  workspaceRevision: z.number(),
  commitSHA: z.string(),
  status: z.enum(["waiting", "building", "ready", "failed"]),
  previewURL: z.string().optional(),
  provider: z.string().optional(),
  deploymentID: z.string().optional(),
  failure: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  activatedAt: z.number().optional(),
});

const roomSchema = z.object({
  id: z.string(),
  title: z.string(),
  titleAuto: z.boolean(),
  repository: z.string(),
  branch: z.string(),
  commitSHA: z.string().optional(),
  workspaceStatus: z.enum(["cloning", "ready", "error"]),
  workspaceError: z.string().optional(),
  agentStatus: z.enum(["idle", "running", "paused", "error"]),
  model: z.string(),
  opencodeSessionID: z.string().optional(),
  workspaceRevision: z.number(),
  publishedWorkspaceRevision: z.number(),
  pullRequestURL: z.string().optional(),
  pullRequestNumber: z.number().optional(),
  pullRequestBranch: z.string().optional(),
  pullRequestRepository: z.string().optional(),
  pullRequestHeadSHA: z.string().optional(),
  autoPublishConfigured: z.boolean(),
  latestRevision: revisionSchema.optional(),
  activeRevision: revisionSchema.optional(),
});

const eventSchema = z.object({
  seq: z.number(),
  id: z.string(),
  kind: z.enum(["participant", "prompt", "opencode", "permission", "system"]),
  createdAt: z.number(),
  actor: actorSchema.optional(),
  payload: jsonRecordSchema,
});

const permissionSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  action: z.string(),
  resources: z.array(z.string()),
  message: z.string().optional(),
  status: z.enum(["pending", "approved", "denied"]),
  createdAt: z.number(),
});

const briefActorSchema = actorSchema.omit({ role: true });

const briefSchema = z.object({
  objective: z.string(),
  constraints: z.array(z.string()),
  validation: z.array(z.string()),
  revision: z.number(),
  review: z.object({
    status: z.enum(["draft", "in_review", "approved", "changes_requested"]),
    round: z.number(),
    startedAt: z.number().optional(),
    startedBy: briefActorSchema.optional(),
    resolvedAt: z.number().optional(),
    resolvedBy: briefActorSchema.optional(),
  }),
  reviewComments: z.array(
    z.object({
      id: z.string(),
      round: z.number(),
      text: z.string(),
      actor: actorSchema,
      createdAt: z.number(),
    }),
  ),
  updatedAt: z.number().optional(),
  updatedBy: briefActorSchema.optional(),
});

const decisionSchema = z.object({
  id: z.string(),
  text: z.string(),
  rationale: z.string().optional(),
  sourceEventID: z.string().optional(),
  actor: actorSchema,
  createdAt: z.number(),
});

const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"),
    room: roomSchema,
    models: z.array(
      z.object({ id: z.string(), name: z.string(), providerID: z.string(), free: z.boolean() }),
    ),
    participants: z.array(participantSchema),
    events: z.array(eventSchema),
    permissions: z.array(permissionSchema),
    queue: z.array(
      z.object({
        eventID: z.string(),
        participant: briefActorSchema,
        text: z.string(),
        createdAt: z.number(),
      }),
    ),
    brief: briefSchema,
    decisions: z.array(decisionSchema),
  }),
  z.object({ type: z.literal("event"), event: eventSchema }),
  z.object({ type: z.literal("presence"), participants: z.array(participantSchema) }),
  z.object({ type: z.literal("room"), room: roomSchema }),
  z.object({ type: z.literal("permissions"), permissions: z.array(permissionSchema) }),
  z.object({ type: z.literal("planning"), brief: briefSchema, decisions: z.array(decisionSchema) }),
  z.object({ type: z.literal("ack"), requestID: z.string().optional() }),
  z.object({ type: z.literal("error"), message: z.string(), requestID: z.string().optional() }),
]);

export function parseServerMessage(text: string): ServerMessage {
  return serverMessageSchema.parse(JSON.parse(text));
}
