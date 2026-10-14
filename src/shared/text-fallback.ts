/** Preserve text defaults for missing or empty strings, without trimming meaningful whitespace. */
export function textOrFallback(value: string | null | undefined, fallback: string): string {
  if (value === undefined || value === null || value.length === 0) {
    return fallback;
  }

  return value;
}
