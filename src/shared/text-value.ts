import { z } from "zod";
import type { JsonValue } from "./json-value";

const textPrimitiveSchema = z.union([z.string(), z.number(), z.boolean()]);

/** Text fields from event payloads may contain primitives, never object coercions. */
export function textValue(value: JsonValue | undefined): string {
  const parsed = textPrimitiveSchema.safeParse(value);

  return parsed.success ? String(parsed.data) : "";
}
