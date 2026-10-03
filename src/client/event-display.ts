import { z } from "zod";
import { jsonRecord, type JsonRecord, type JsonValue } from "../shared/json-value";
import { textValue } from "../shared/text-value";
import type { TimelineEvent } from "../shared/protocol";

export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

export interface QuestionField {
  key: string;
  title: string;
  description: string;
  type: "string" | "multiselect";
  options: QuestionOption[];
  custom: boolean;
}

export type DisplayEvent =
  | {
      type: "prompt";
      title: string;
      detail: string;
      delivery: "steer" | "queue";
    }
  | { type: "reasoning"; title: string; detail: string; streaming?: boolean }
  | {
      type: "tool";
      title: string;
      detail?: string;
      output?: string;
      status: "running" | "completed" | "failed";
      command?: string;
    }
  | { type: "text"; title: string; detail: string; streaming?: boolean }
  | {
      type: "question";
      title: string;
      detail: string;
      formID: string;
      sessionID: string;
      fields: QuestionField[];
      status: "pending" | "answered" | "cancelled";
      answer?: Record<string, string | string[]>;
    }
  | { type: "diff"; title: string; additions: number; deletions: number }
  | { type: "permission"; title: string; detail: string; status: string }
  | { type: "participant"; title: string; detail: string }
  | { type: "system"; title: string; detail: string };

const toolInputSchema = z
  .object({
    command: z.string().optional().catch(undefined),
    filePath: z.string().optional().catch(undefined),
    replaceAll: z.boolean().optional().catch(undefined),
    questions: z
      .array(z.object({ question: z.string().optional().catch(undefined) }).catch({}))
      .optional()
      .catch(undefined),
  })
  .catch({});

const questionOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional().catch(undefined),
});

const questionFieldSchema = z.object({
  key: z.string(),
  type: z.enum(["string", "multiselect"]),
  title: z.string().catch("Question"),
  description: z.string().catch(""),
  custom: z
    .literal(false)
    .transform(() => false)
    .catch(true),
  options: z
    .array(questionOptionSchema.optional().catch(undefined))
    .catch([])
    .transform((values) => values.flatMap((value) => (value ? [value] : []))),
});

const questionFormSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  metadata: z.object({ kind: z.string() }),
  fields: z.array(questionFieldSchema.optional().catch(undefined)),
});

const questionAnswerValueSchema = z.union([z.string(), z.array(z.string())]);

function asRecord(value: JsonValue | undefined): JsonRecord {
  return jsonRecord(value);
}

function stringifyToolInput(value: JsonValue | undefined) {
  const text = z.string().safeParse(value);

  if (text.success) {
    return text.data;
  }

  if (!value) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return textValue(value);
  }
}

function summarizeToolInput(tool: string, value: JsonValue | undefined) {
  const input = toolInputSchema.parse(value ?? {});

  if ((tool === "bash" || tool === "shell") && input.command !== undefined) {
    return `$ ${input.command}`;
  }

  if (tool === "edit" && input.filePath !== undefined) {
    return `Editing ${input.filePath}${input.replaceAll === true ? " (all matches)" : ""}`;
  }

  if (tool === "question" && input.questions !== undefined) {
    const questions = input.questions;
    const first = questions[0];

    if (first?.question !== undefined) {
      return first.question;
    }

    return `Asking ${questions.length} question${questions.length === 1 ? "" : "s"}`;
  }

  return stringifyToolInput(value);
}

function bashCommand(tool: string, value: JsonValue | undefined): string | undefined {
  const input = toolInputSchema.parse(value ?? {});

  if ((tool === "bash" || tool === "shell") && input.command !== undefined) {
    return input.command;
  }

  return undefined;
}

function displayToolName(tool: string) {
  return tool === "shell" ? "bash" : tool;
}

function textFromContent(value: JsonValue | undefined) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((item) => {
      const record = asRecord(item);

      return record.type === "text"
        ? textValue(record.text ?? "")
        : record.name
          ? `[file] ${textValue(record.name)}`
          : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function displayEvent(event: TimelineEvent): DisplayEvent {
  const payload = event.payload;

  if (event.kind === "prompt") {
    return {
      type: "prompt",
      title: event.actor?.name ?? "Participant",
      detail: textValue(payload.text ?? ""),
      delivery: payload.delivery === "queue" ? "queue" : "steer",
    };
  }

  if (event.kind === "participant") {
    return {
      type: "participant",
      title: event.actor?.name ?? "Participant",
      detail: textValue(payload.action ?? "joined"),
    };
  }

  if (event.kind === "permission") {
    return {
      type: "permission",
      title: textValue(payload.action ?? "Permission request"),
      detail: `${event.actor?.name ?? "Maintainer"} ${payload.status === "approved" ? "approved" : "denied"} this side effect`,
      status: textValue(payload.status ?? "resolved"),
    };
  }

  if (payload.type === "reasoning") {
    return {
      type: "reasoning",
      title: "OpenCode reasoning",
      detail: textValue(payload.text ?? ""),
    };
  }

  if (payload.type === "tool") {
    const tool = textValue(payload.tool ?? "tool call");

    return {
      type: "tool",
      title: displayToolName(tool),
      detail: payload.summary ? textValue(payload.summary) : undefined,
      output: payload.output ? textValue(payload.output) : undefined,
      command: bashCommand(tool, payload.input),
      status:
        payload.status === "running"
          ? "running"
          : payload.status === "failed" || payload.status === "error"
            ? "failed"
            : "completed",
    };
  }

  if (payload.type === "text") {
    return {
      type: "text",
      title: "OpenCode",
      detail: textValue(payload.text ?? ""),
    };
  }

  if (payload.type === "diff") {
    return {
      type: "diff",
      title: textValue(payload.text ?? "Files changed"),
      additions: Number(payload.additions ?? 0),
      deletions: Number(payload.deletions ?? 0),
    };
  }

  if (payload.type === "raw") {
    const raw = asRecord(payload.event);
    const data = asRecord(raw.data);
    const type = textValue(raw.type ?? "OpenCode event");
    const question = displayQuestion(type, data);

    if (question) {
      return question;
    }

    if (type === "session.reasoning.delta") {
      return {
        type: "reasoning",
        title: "OpenCode reasoning",
        detail: textValue(data.delta ?? ""),
        streaming: data.streaming !== false,
      };
    }

    if (type === "session.text.delta") {
      return {
        type: "text",
        title: "OpenCode",
        detail: textValue(data.delta ?? ""),
        streaming: data.streaming !== false,
      };
    }

    if (type === "session.tool.called") {
      const tool = textValue(data.tool ?? data.name ?? "tool call");

      return {
        type: "tool",
        title: displayToolName(tool),
        detail: summarizeToolInput(tool, data.input),
        command: bashCommand(tool, data.input),
        status: "running",
      };
    }

    if (type === "session.tool.progress") {
      return {
        type: "tool",
        title: textValue(data.tool ?? "tool call"),
        detail: stringifyToolInput(data.metadata ?? data.state),
        status: "running",
      };
    }

    if (type === "session.tool.success") {
      const tool = textValue(data.tool ?? data.name ?? "tool call");

      return {
        type: "tool",
        title: displayToolName(tool),
        detail: summarizeToolInput(tool, data.input) || "Completed",
        output: textFromContent(data.content),
        command: bashCommand(tool, data.input),
        status: "completed",
      };
    }

    if (type === "session.tool.failed") {
      const tool = textValue(data.tool ?? data.name ?? "tool call");

      return {
        type: "tool",
        title: displayToolName(tool),
        detail: stringifyToolInput(data.error) || "Tool failed",
        command: bashCommand(tool, data.input),
        status: "failed",
      };
    }

    const readable = type.replace(/^session\./, "").replaceAll(".", " ");

    return { type: "system", title: "OpenCode", detail: readable };
  }

  return {
    type: "system",
    title: "Relay",
    detail: textValue(payload.text ?? payload.type ?? "Session updated"),
  };
}

function displayQuestion(
  type: string,
  data: JsonRecord,
): Extract<DisplayEvent, { type: "question" }> | undefined {
  if (!type.startsWith("form.")) {
    return undefined;
  }

  const parsed = questionFormSchema.safeParse(data.form);

  if (!parsed.success || parsed.data.metadata.kind !== "question") {
    return undefined;
  }

  const form = parsed.data;
  const fields: QuestionField[] = form.fields.flatMap((field) => (field ? [field] : []));

  if (!fields.length) {
    return undefined;
  }

  const answer: Record<string, string | string[]> = {};

  for (const [key, raw] of Object.entries(asRecord(data.answer))) {
    const entry = questionAnswerValueSchema.safeParse(raw);

    if (entry.success) {
      answer[key] = entry.data;
    }
  }

  return {
    type: "question",
    title:
      type === "form.replied"
        ? "Question answered"
        : type === "form.cancelled"
          ? "Question dismissed"
          : "OpenCode has a question",
    detail: fields[0].description,
    formID: form.id,
    sessionID: form.sessionID,
    fields,
    status:
      type === "form.replied" ? "answered" : type === "form.cancelled" ? "cancelled" : "pending",
    answer: type === "form.replied" ? answer : undefined,
  };
}

export function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}
