/**
 * Extracts the session title from an OpenCode `session.updated` event emitted
 * by the built-in `use-title` agent. The agent calls `setTitle`, which patches
 * the session and publishes `session.updated` with the new title under
 * `info.title`. Returns `undefined` for unrelated events or for OpenCode's
 * placeholder default titles so they are never captured as room titles.
 *
 * This helper is intentionally free of any `cloudflare:workers` imports so it
 * can be unit tested outside the Workers runtime.
 */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function sessionTitleFromEvent(
  event: Record<string, unknown>,
): string | undefined {
  const type = typeof event.type === "string" ? event.type : "";
  if (type !== "session.updated" && type !== "session.next.updated")
    return undefined;
  const data = asRecord(event.data);
  const properties = asRecord(event.properties);
  const info = asRecord(
    data.info ?? properties.info ?? (event as Record<string, unknown>).info,
  );
  const candidate =
    info.title ?? (typeof data.title === "string" ? data.title : undefined);
  if (typeof candidate !== "string") return undefined;
  const title = candidate.trim();
  if (!title || /^(new session|untitled)/i.test(title)) return undefined;
  return title;
}
