export function applyUnifiedDiff(
  files: Map<string, string>,
  patch: string,
): Array<{ path: string; original: string; content: string }> {
  const lines = patch.replaceAll("\r\n", "\n").split("\n");
  const changes: Array<{ path: string; original: string; content: string }> = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].startsWith("--- ")) {
      index += 1;
      continue;
    }
    const oldPath = patchPath(lines[index].slice(4));
    index += 1;
    if (index >= lines.length || !lines[index].startsWith("+++ ")) throw new Error("Patch is missing a +++ file header");
    const newPath = patchPath(lines[index].slice(4));
    index += 1;
    if (!newPath || newPath === "/dev/null") throw new Error("Deleting files is not supported by the Workers-native patch backend");
    const path = validatePatchPath(newPath);
    const original = oldPath === "/dev/null" ? "" : files.get(validatePatchPath(oldPath));
    if (original === undefined) throw new Error(`Patch target is not tracked: ${oldPath}`);
    const source = original.split("\n");
    const output: string[] = [];
    let sourceIndex = 0;
    let sawHunk = false;

    while (index < lines.length && !lines[index].startsWith("--- ")) {
      const header = lines[index].match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (!header) {
        index += 1;
        continue;
      }
      sawHunk = true;
      const hunkStart = Number(header[1]) - 1;
      if (hunkStart < sourceIndex || hunkStart > source.length) throw new Error(`Patch hunk is out of range for ${path}`);
      output.push(...source.slice(sourceIndex, hunkStart));
      sourceIndex = hunkStart;
      index += 1;
      while (index < lines.length && !lines[index].startsWith("@@ ") && !lines[index].startsWith("--- ")) {
        const line = lines[index];
        if (line.startsWith("\\ No newline")) {
          index += 1;
          continue;
        }
        if (!line.length) break;
        const marker = line[0];
        const value = line.slice(1);
        if (marker === " " || marker === "-") {
          if (source[sourceIndex] !== value) throw new Error(`Patch context did not match ${path} at line ${sourceIndex + 1}`);
          if (marker === " ") output.push(value);
          sourceIndex += 1;
        } else if (marker === "+") {
          output.push(value);
        } else {
          break;
        }
        index += 1;
      }
    }
    if (!sawHunk) throw new Error(`Patch contains no hunks for ${path}`);
    output.push(...source.slice(sourceIndex));
    const content = output.join("\n");
    files.set(path, content);
    changes.push({ path, original, content });
  }
  if (!changes.length) throw new Error("Patch did not contain a supported unified diff");
  return changes;
}

function patchPath(value: string): string {
  const token = value.trim().split(/\s+/)[0];
  if (token === "/dev/null") return token;
  return token.replace(/^[ab]\//, "");
}

function validatePatchPath(value: string): string {
  const normalized = value.trim().replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (!normalized || normalized.length > 500 || normalized.startsWith("/") || segments.includes("..") || value.includes("\0")) {
    throw new Error("Patch path must stay within the repository");
  }
  return normalized;
}
