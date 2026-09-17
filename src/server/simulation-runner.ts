import type { WorkspaceInfo } from "./workspace";

/**
 * Scripted search/diff playback for `OPENCODE_MODE: simulation`.
 * The Durable Object keeps turn generation and queue consume; this module
 * talks to workspace `search`/`diff` and emits timeline payloads through
 * `emitEvent` so the room can `insertEvent`/`broadcast`.
 */

export interface SimulatedWorkspace {
  ensureReady(): Promise<WorkspaceInfo>;
  search(query: string): Promise<string>;
  diff(): Promise<string>;
}

export interface SimulatedQueueItem {
  eventID: string;
  text: string;
}

export function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function runSimulatedTurn(options: {
  prompt: string;
  workspace: SimulatedWorkspace;
  emitEvent: (payload: Record<string, unknown>) => void;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<void> {
  const delay = options.wait ?? wait;
  const searchTerm = extractSearchTerm(options.prompt);
  const workspace = await options.workspace.ensureReady();
  const searchOutput = await options.workspace.search(searchTerm);
  const diffOutput = await options.workspace.diff();
  const workspaceKind = workspace.directory.startsWith("github://")
    ? "Workers-native GitHub snapshot"
    : "Railway Sandbox";
  const sequence: Array<{ delay: number; payload: Record<string, unknown> }> = [
    {
      delay: 180,
      payload: {
        type: "reasoning",
        text: `I’ll inspect ${workspace.repository}@${workspace.commitSHA.slice(0, 8)} for ${searchTerm}, then read the shared Git diff.`,
      },
    },
    {
      delay: 260,
      payload: {
        type: "tool",
        tool: "bash",
        status: "running",
        summary: "Searching the repository…",
      },
    },
    {
      delay: 320,
      payload: {
        type: "tool",
        tool: "bash",
        status: "completed",
        summary:
          searchOutput === "No matches found." ? "No matches" : "Repository search completed",
        output: searchOutput,
      },
    },
    {
      delay: 280,
      payload: {
        type: "tool",
        tool: "bash",
        status: "completed",
        summary: "Shared Git diff inspected",
        output: diffOutput,
      },
    },
    {
      delay: 240,
      payload: {
        type: "text",
        text: `I inspected the real workspace pinned at ${workspace.commitSHA.slice(0, 12)}. The search and diff transcripts above came from the ${workspaceKind}; no repository files were changed.`,
      },
    },
  ];

  for (const step of sequence) {
    await delay(step.delay);
    options.emitEvent(step.payload);
  }
}

export async function drainSimulatedQueue(options: {
  nextQueuedPrompt: () => SimulatedQueueItem | undefined;
  consumeQueuedPrompt: (eventID: string) => void;
  runTurn: (text: string) => Promise<void>;
}): Promise<void> {
  while (true) {
    const next = options.nextQueuedPrompt();
    if (!next) {
      return;
    }
    options.consumeQueuedPrompt(next.eventID);
    await options.runTurn(next.text);
  }
}

export function extractSearchTerm(prompt: string): string {
  const tokens = prompt.match(/[A-Za-z_$][\w$.-]{2,}/g) ?? [];
  const stopwords = new Set([
    "agent",
    "and",
    "are",
    "can",
    "check",
    "cite",
    "code",
    "does",
    "files",
    "find",
    "for",
    "from",
    "how",
    "implemented",
    "implementation",
    "investigate",
    "look",
    "real",
    "repository",
    "show",
    "the",
    "this",
    "where",
    "with",
  ]);

  return (
    tokens.find((token) => /[A-Z].*[A-Z]/.test(token) || /[_.$-]/.test(token)) ??
    tokens.find((token) => !stopwords.has(token.toLowerCase())) ??
    "WebSocket"
  );
}
