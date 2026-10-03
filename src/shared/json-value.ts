import { z } from "zod";

/** JSON-compatible extension data retained for forward-compatible OpenCode events.
 * Undefined is allowed only for in-memory optional properties; JSON.stringify omits them.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonRecord;

export interface JsonRecord {
  [key: string]: JsonValue | undefined;
}

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    jsonRecordSchema,
  ]),
);

export const jsonRecordSchema: z.ZodType<JsonRecord> = z.record(
  z.string(),
  jsonValueSchema.optional(),
);

/** Decode unknown extension values once, before event consumers access their fields. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the runtime decoder for external JSON extension data, not an application input contract.
export function parseJsonRecord(value: unknown): JsonRecord {
  return jsonRecordSchema.parse(value);
}

export function jsonRecord(value: JsonValue | undefined): JsonRecord {
  const parsed = jsonRecordSchema.safeParse(value);

  return parsed.success ? parsed.data : {};
}
