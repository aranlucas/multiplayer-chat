interface KeyedTextItem {
  key: string;
  text: string;
}

export function keyedTextItems(items: readonly string[]): KeyedTextItem[] {
  const occurrences = new Map<string, number>();

  return items.map((text) => {
    const occurrence = occurrences.get(text) ?? 0;
    occurrences.set(text, occurrence + 1);

    return { key: JSON.stringify([text, occurrence]), text };
  });
}
