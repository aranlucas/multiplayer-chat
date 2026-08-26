import type { TimelineEvent } from "../shared/protocol";

export type DisplayEvent =
  | { type: "prompt"; title: string; detail: string; delivery: "steer" | "queue" }
  | { type: "reasoning"; title: string; detail: string; streaming?: boolean }
  | { type: "tool"; title: string; detail?: string; output?: string; status: "running" | "completed" | "failed" }
  | { type: "text"; title: string; detail: string; streaming?: boolean }
  | { type: "diff"; title: string; additions: number; deletions: number }
  | { type: "permission"; title: string; detail: string; status: string }
  | { type: "participant"; title: string; detail: string }
  | { type: "system"; title: string; detail: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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

function textFromContent(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => {
      const record = asRecord(item);
      return record.type === "text" ? String(record.text ?? "") : record.name ? `[file] ${String(record.name)}` : "";
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
    return { type: "participant", title: event.actor?.name ?? "Participant", detail: String(payload.action ?? "joined") };
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
    return { type: "reasoning", title: "OpenCode reasoning", detail: String(payload.text ?? "") };
  }
  if (payload.type === "tool") {
    return {
      type: "tool",
      title: String(payload.tool ?? "tool call"),
      detail: payload.summary ? String(payload.summary) : undefined,
      output: payload.output ? String(payload.output) : undefined,
      status: payload.status === "running" ? "running" : payload.status === "failed" ? "failed" : "completed",
    };
  }
  if (payload.type === "text") {
    return { type: "text", title: "OpenCode", detail: String(payload.text ?? "") };
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
    if (type === "session.reasoning.delta") {
      return { type: "reasoning", title: "OpenCode reasoning", detail: String(data.delta ?? ""), streaming: data.streaming !== false };
    }
    if (type === "session.text.delta") {
      return { type: "text", title: "OpenCode", detail: String(data.delta ?? ""), streaming: data.streaming !== false };
    }
    if (type === "session.tool.called") {
      const input = stringifyToolInput(data.input);
      return {
        type: "tool",
        title: String(data.tool ?? data.name ?? "tool call"),
        detail: input,
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
      return {
        type: "tool",
        title: String(data.tool ?? data.name ?? "tool call"),
        detail: data.executed === false ? "Not executed" : "Completed",
        output: textFromContent(data.content),
        status: "completed",
      };
    }
    if (type === "session.tool.failed") {
      return {
        type: "tool",
        title: String(data.tool ?? "tool call"),
        detail: String(data.error ?? "Tool failed"),
        status: "failed",
      };
    }
    const readable = type.replace(/^session\./, "").replaceAll(".", " ");
    return { type: "system", title: "OpenCode", detail: readable };
  }
  return { type: "system", title: "Relay", detail: String(payload.text ?? payload.type ?? "Session updated") };
}

export function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp);
}
