import { z } from "zod";
import { jsonRecordSchema, type JsonRecord } from "../shared/json-value";

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
const sessionTitleEventSchema = z.object({
  type: z.string().catch(""),
  data: z
    .object({
      info: jsonRecordSchema.optional().catch(undefined),
      title: z.string().optional().catch(undefined),
    })
    .catch({}),
  properties: z.object({ info: jsonRecordSchema.optional().catch(undefined) }).catch({}),
  info: jsonRecordSchema.optional().catch(undefined),
});

export function sessionTitleFromEvent(event: JsonRecord): string | undefined {
  const parsed = sessionTitleEventSchema.parse(event);

  if (parsed.type !== "session.updated" && parsed.type !== "session.next.updated") {
    return undefined;
  }

  const info = parsed.data.info ?? parsed.properties.info ?? parsed.info;
  const candidate = z.string().safeParse(info?.title ?? parsed.data.title);

  if (!candidate.success) {
    return undefined;
  }

  const title = candidate.data.trim();

  return !title || /^(new session|untitled)/i.test(title) ? undefined : title;
}
