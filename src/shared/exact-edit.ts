export function replaceExact(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string {
  const occurrences = content.split(oldString).length - 1;
  if (!occurrences)
    throw new Error(
      "Could not find oldString in the file. Re-read the file and provide an exact match, including whitespace.",
    );
  if (!replaceAll && occurrences > 1)
    throw new Error(
      "Found multiple matches for oldString. Re-read the file and include more surrounding context or set replaceAll to true.",
    );
  return replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);
}
