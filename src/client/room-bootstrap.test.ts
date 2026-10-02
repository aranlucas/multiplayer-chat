// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveRelayBootstrap } from "./room-bootstrap";

const roomID = "native-preview-room";
const alice = { id: "alice", name: "Alice", role: "maintainer" };
const bob = { id: "bob", name: "Bob", role: "contributor" };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

function enterHandoff(participant: typeof alice, draft: string) {
  window.history.replaceState(
    null,
    "",
    `/r/${roomID}?control=https%3A%2F%2Frelay-multiplayer-agent.aranlucas.workers.dev#handoff=ticket`,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          participant,
          clientState: { draft, selectedID: "shared-event", mobileTab: "brief" },
        }),
      ),
    ),
  );
  return resolveRelayBootstrap();
}

it("persists transferred client state on the destination before a reload", async () => {
  const result = await enterHandoff(alice, "Alice's unsent native Preview draft");
  expect(result.resumeState?.draft).toBe("Alice's unsent native Preview draft");
  expect(window.location.hash).toBe("");
  expect(sessionStorage.getItem(`relay:${roomID}:draft`)).toBe(result.resumeState?.draft);
  expect(sessionStorage.getItem(`relay:${roomID}:selected`)).toBe("shared-event");
  expect(sessionStorage.getItem(`relay:${roomID}:mobile-tab`)).toBe("brief");
  expect((await resolveRelayBootstrap()).identity).toEqual(alice);
});

it("keeps each tab's participant when another tab redeems a handoff on the same origin", async () => {
  await enterHandoff(alice, "Alice's draft");
  const aliceSession: Array<[string, string]> = [];
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index);
    const value = key === null ? null : sessionStorage.getItem(key);
    if (key !== null && value !== null) {
      aliceSession.push([key, value]);
    }
  }

  // Tabs share localStorage, but each has its own sessionStorage.
  sessionStorage.clear();
  await enterHandoff(bob, "Bob's draft");
  expect((await resolveRelayBootstrap()).identity).toEqual(bob);

  sessionStorage.clear();
  for (const [key, value] of aliceSession) {
    sessionStorage.setItem(key, value);
  }
  expect((await resolveRelayBootstrap()).identity).toEqual(alice);
});

it("retains the existing identity fallback when tab storage is malformed", async () => {
  await enterHandoff(alice, "Alice's draft");
  sessionStorage.setItem(`relay:${roomID}:identity`, "invalid JSON");
  expect((await resolveRelayBootstrap()).identity).toEqual(alice);
});
