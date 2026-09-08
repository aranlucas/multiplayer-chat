/** Text fields from event payloads may contain primitives, never object coercions. */
export function textValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}
