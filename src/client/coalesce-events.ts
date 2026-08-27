import type { TimelineEvent } from "../shared/protocol";

const STREAM_TYPES = new Set(["session.reasoning.delta", "session.text.delta"]);
const STREAM_BOUNDARIES = new Set([
  "session.reasoning.started",
  "session.reasoning.ended",
  "session.text.started",
  "session.text.ended",
]);

export function coalesceTimelineEvents(
  events: TimelineEvent[],
): TimelineEvent[] {
  const result: TimelineEvent[] = [];
  const streams = new Map<string, number>();
  const tools = new Map<string, number>();
  const forms = new Map<string, number>();

  for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
    const raw = rawEvent(event);
    if (!raw) {
      result.push(event);
      continue;
    }
    const type = String(raw.type ?? "");
    const data = asRecord(raw.data);
    if (type.startsWith("form.")) {
      mergeFormLifecycle(result, forms, event, type, data);
      continue;
    }
    if (type.startsWith("session.tool.")) {
      mergeToolLifecycle(result, tools, event, type, data);
      continue;
    }
    if (STREAM_TYPES.has(type)) {
      mergeStream(
        result,
        streams,
        event,
        type,
        data,
        String(data.delta ?? ""),
        true,
      );
      continue;
    }
    if (type === "session.reasoning.ended" || type === "session.text.ended") {
      const deltaType = type.replace(".ended", ".delta");
      mergeStream(
        result,
        streams,
        event,
        deltaType,
        data,
        String(data.text ?? ""),
        false,
        true,
      );
      continue;
    }
    if (STREAM_BOUNDARIES.has(type)) continue;
    result.push(event);
  }
  return result;
}

function mergeFormLifecycle(
  result: TimelineEvent[],
  forms: Map<string, number>,
  event: TimelineEvent,
  type: string,
  data: Record<string, unknown>,
) {
  const incomingForm = asRecord(data.form);
  const id = String(incomingForm.id ?? data.id ?? event.id);
  const existingIndex = forms.get(id);
  const existing =
    existingIndex === undefined ? undefined : result[existingIndex];
  const existingRaw = existing ? rawEvent(existing) : undefined;
  const existingData = asRecord(existingRaw?.data);
  const form =
    Object.keys(incomingForm).length > 0 ? incomingForm : existingData.form;
  const merged: TimelineEvent = {
    ...(existing ?? event),
    id: `form:${id}`,
    payload: {
      type: "raw",
      event: {
        ...(rawEvent(existing ?? event) ?? {}),
        type,
        data: { ...existingData, ...data, form },
      },
    },
  };

  if (existingIndex === undefined) {
    forms.set(id, result.length);
    result.push(merged);
    return;
  }
  result[existingIndex] = merged;
}

function mergeToolLifecycle(
  result: TimelineEvent[],
  tools: Map<string, number>,
  event: TimelineEvent,
  type: string,
  data: Record<string, unknown>,
) {
  const key = toolKey(event, data);
  const existingIndex = tools.get(key);
  const existing =
    existingIndex === undefined ? undefined : result[existingIndex];
  const existingRaw = existing ? rawEvent(existing) : undefined;
  const existingData = asRecord(existingRaw?.data);
  const tool = String(
    data.tool ??
      data.name ??
      existingData.tool ??
      existingData.name ??
      "tool call",
  );
  const parsedInput =
    data.input ?? parseToolInput(data.text) ?? existingData.input ?? {};
  const finalType =
    type === "session.tool.success" || type === "session.tool.failed"
      ? type
      : "session.tool.called";
  const mergedData = {
    ...existingData,
    ...data,
    id: data.id ?? existingData.id ?? key,
    tool,
    input: parsedInput,
  };
  const merged = toolEvent(existing ?? event, key, finalType, mergedData);

  if (existingIndex === undefined) {
    tools.set(key, result.length);
    result.push(merged);
    return;
  }
  result[existingIndex] = merged;
}

function toolEvent(
  source: TimelineEvent,
  key: string,
  type: string,
  data: Record<string, unknown>,
): TimelineEvent {
  const raw = rawEvent(source) ?? {};
  return {
    ...source,
    id: `tool:${key}`,
    payload: {
      type: "raw",
      event: { ...raw, type, data },
    },
  };
}

function toolKey(
  event: TimelineEvent,
  data: Record<string, unknown>,
): string {
  return [
    data.sessionID ?? "session",
    data.assistantMessageID ?? "message",
    data.callID ?? data.id ?? event.id,
  ]
    .map(String)
    .join(":");
}

function parseToolInput(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function mergeStream(
  result: TimelineEvent[],
  streams: Map<string, number>,
  event: TimelineEvent,
  type: string,
  data: Record<string, unknown>,
  text: string,
  streaming: boolean,
  replace = false,
) {
  const key = streamKey(type, data);
  const index = streams.get(key);
  if (index === undefined) {
    if (text.length === 0) return;
    streams.set(key, result.length);
    result.push(streamEvent(event, key, type, data, text, streaming));
    return;
  }
  const existing = result[index];
  const existingRaw = rawEvent(existing)!;
  const existingData = asRecord(existingRaw.data);
  result[index] = streamEvent(
    existing,
    key,
    type,
    data,
    replace && text.length > 0
      ? text
      : String(existingData.delta ?? "") + (replace ? "" : text),
    streaming,
  );
}

function streamEvent(
  source: TimelineEvent,
  key: string,
  type: string,
  data: Record<string, unknown>,
  text: string,
  streaming: boolean,
): TimelineEvent {
  const raw = rawEvent(source) ?? {};
  return {
    ...source,
    id: `stream:${key}`,
    payload: {
      type: "raw",
      event: {
        ...raw,
        type,
        data: { ...data, delta: text, streaming },
      },
    },
  };
}

function streamKey(type: string, data: Record<string, unknown>): string {
  return [type, data.sessionID, data.assistantMessageID, data.ordinal ?? 0]
    .map(String)
    .join(":");
}

function rawEvent(event: TimelineEvent): Record<string, unknown> | undefined {
  if (event.kind !== "opencode" || event.payload.type !== "raw")
    return undefined;
  return asRecord(event.payload.event);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
