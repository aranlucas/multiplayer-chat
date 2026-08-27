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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringifyToolInput(value: unknown) {
  if (typeof value === "string") return value;
  if (!value) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function summarizeToolInput(tool: string, value: unknown) {
  const input = asRecord(value);
  if (
    (tool === "bash" || tool === "shell") &&
    typeof input.command === "string"
  )
    return `$ ${input.command}`;
  if (tool === "edit" && typeof input.filePath === "string")
    return `Editing ${input.filePath}${input.replaceAll === true ? " (all matches)" : ""}`;
  if (tool === "question" && Array.isArray(input.questions)) {
    const questions = input.questions.map(asRecord);
    const first = questions[0];
    if (typeof first?.question === "string") return first.question;
    return `Asking ${questions.length} question${questions.length === 1 ? "" : "s"}`;
  }
  return stringifyToolInput(value);
}

function bashCommand(tool: string, value: unknown): string | undefined {
  const input = asRecord(value);
  if (
    (tool === "bash" || tool === "shell") &&
    typeof input.command === "string"
  )
    return input.command;
  return undefined;
}

function displayToolName(tool: string) {
  return tool === "shell" ? "bash" : tool;
}

function textFromContent(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => {
      const record = asRecord(item);
      return record.type === "text"
        ? String(record.text ?? "")
        : record.name
          ? `[file] ${String(record.name)}`
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
      detail: String(payload.text ?? ""),
      delivery: payload.delivery === "queue" ? "queue" : "steer",
    };
  }
  if (event.kind === "participant") {
    return {
      type: "participant",
      title: event.actor?.name ?? "Participant",
      detail: String(payload.action ?? "joined"),
    };
  }
  if (event.kind === "permission") {
    return {
      type: "permission",
      title: String(payload.action ?? "Permission request"),
      detail: `${event.actor?.name ?? "Maintainer"} ${payload.status === "approved" ? "approved" : "denied"} this side effect`,
      status: String(payload.status ?? "resolved"),
    };
  }
  if (payload.type === "reasoning") {
    return {
      type: "reasoning",
      title: "OpenCode reasoning",
      detail: String(payload.text ?? ""),
    };
  }
  if (payload.type === "tool") {
    const tool = String(payload.tool ?? "tool call");
    return {
      type: "tool",
      title: displayToolName(tool),
      detail: payload.summary ? String(payload.summary) : undefined,
      output: payload.output ? String(payload.output) : undefined,
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
      detail: String(payload.text ?? ""),
    };
  }
  if (payload.type === "diff") {
    return {
      type: "diff",
      title: String(payload.text ?? "Files changed"),
      additions: Number(payload.additions ?? 0),
      deletions: Number(payload.deletions ?? 0),
    };
  }
  if (payload.type === "raw") {
    const raw = asRecord(payload.event);
    const data = asRecord(raw.data);
    const type = String(raw.type ?? "OpenCode event");
    const question = displayQuestion(type, data);
    if (question) return question;
    if (type === "session.reasoning.delta") {
      return {
        type: "reasoning",
        title: "OpenCode reasoning",
        detail: String(data.delta ?? ""),
        streaming: data.streaming !== false,
      };
    }
    if (type === "session.text.delta") {
      return {
        type: "text",
        title: "OpenCode",
        detail: String(data.delta ?? ""),
        streaming: data.streaming !== false,
      };
    }
    if (type === "session.tool.called") {
      const tool = String(data.tool ?? data.name ?? "tool call");
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
        title: String(data.tool ?? "tool call"),
        detail: stringifyToolInput(data.metadata ?? data.state),
        status: "running",
      };
    }
    if (type === "session.tool.success") {
      const tool = String(data.tool ?? data.name ?? "tool call");
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
      const tool = String(data.tool ?? data.name ?? "tool call");
      return {
        type: "tool",
        title: displayToolName(tool),
        detail:
          typeof data.error === "string"
            ? data.error
            : stringifyToolInput(data.error) || "Tool failed",
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
    detail: String(payload.text ?? payload.type ?? "Session updated"),
  };
}

function displayQuestion(
  type: string,
  data: Record<string, unknown>,
): Extract<DisplayEvent, { type: "question" }> | undefined {
  if (!type.startsWith("form.")) return undefined;
  const form = asRecord(data.form);
  const metadata = asRecord(form.metadata);
  if (metadata.kind !== "question") return undefined;
  if (
    typeof form.id !== "string" ||
    typeof form.sessionID !== "string" ||
    !Array.isArray(form.fields)
  )
    return undefined;

  const fields = form.fields
    .map((value): QuestionField | undefined => {
      const field = asRecord(value);
      if (
        typeof field.key !== "string" ||
        (field.type !== "string" && field.type !== "multiselect")
      )
        return undefined;
      const options = Array.isArray(field.options)
        ? field.options
            .map((value): QuestionOption | undefined => {
              const option = asRecord(value);
              if (
                typeof option.value !== "string" ||
                typeof option.label !== "string"
              )
                return undefined;
              return {
                value: option.value,
                label: option.label,
                description:
                  typeof option.description === "string"
                    ? option.description
                    : undefined,
              };
            })
            .filter((value): value is QuestionOption => Boolean(value))
        : [];
      return {
        key: field.key,
        title: typeof field.title === "string" ? field.title : "Question",
        description:
          typeof field.description === "string" ? field.description : "",
        type: field.type,
        options,
        custom: field.custom !== false,
      };
    })
    .filter((value): value is QuestionField => Boolean(value));
  if (!fields.length) return undefined;

  const answer = asRecord(data.answer);
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
      type === "form.replied"
        ? "answered"
        : type === "form.cancelled"
          ? "cancelled"
          : "pending",
    answer:
      type === "form.replied"
        ? Object.fromEntries(
            Object.entries(answer).filter(
              (entry): entry is [string, string | string[]] =>
                typeof entry[1] === "string" ||
                (Array.isArray(entry[1]) &&
                  entry[1].every((item) => typeof item === "string")),
            ),
          )
        : undefined,
  };
}

export function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}
