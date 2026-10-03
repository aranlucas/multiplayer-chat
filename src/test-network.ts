import { beforeEach, vi } from "vitest";

const localFetch = globalThis.fetch.bind(globalThis);

const NativeWebSocket = globalThis.WebSocket;

/** Tests may use local HTTP fixtures or an explicit transport stub, never a real service. */
function requireLoopback(url: string | URL) {
  const target = new URL(url);

  if (
    target.hostname !== "localhost" &&
    target.hostname !== "127.0.0.1" &&
    target.hostname !== "[::1]"
  ) {
    throw new Error(`External network disabled in tests: ${target.origin}`);
  }
}

beforeEach(() => {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    requireLoopback(input instanceof Request ? input.url : input);

    return localFetch(input, init);
  });
  vi.stubGlobal(
    "WebSocket",
    class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        requireLoopback(url);
        super(url, protocols);
      }
    },
  );
});
