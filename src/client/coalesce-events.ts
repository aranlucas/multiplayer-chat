import type { TimelineEvent } from "../shared/protocol";

const STREAM_TYPES = new Set(["session.reasoning.delta", "session.text.delta"]);
const STREAM_BOUNDARIES = new Set([
  "session.reasoning.started",
  "session.reasoning.ended",
  "session.text.started",
  "session.text.ended",
]);

export function coalesceTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  const result: TimelineEvent[] = [];
  const streams = new Map<string, number>();

  for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
    const raw = rawEvent(event);
    if (!raw) {
      result.push(event);
      continue;
    }
    const type = String(raw.type ?? "");
    const data = asRecord(raw.data);
    if (STREAM_TYPES.has(type)) {
      mergeStream(result, streams, event, type, data, String(data.delta ?? ""), true);
      continue;
    }
    if (type === "session.reasoning.ended" || type === "session.text.ended") {
      const deltaType = type.replace(".ended", ".delta");
      mergeStream(result, streams, event, deltaType, data, String(data.text ?? ""), false, true);
      continue;
    }
    if (STREAM_BOUNDARIES.has(type)) continue;
    result.push(event);
  }
  return result;
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
    replace ? text : String(existingData.delta ?? "") + text,
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
  return [type, data.sessionID, data.assistantMessageID, data.ordinal ?? 0].map(String).join(":");
}

function rawEvent(event: TimelineEvent): Record<string, unknown> | undefined {
  if (event.kind !== "opencode" || event.payload.type !== "raw") return undefined;
  return asRecord(event.payload.event);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
