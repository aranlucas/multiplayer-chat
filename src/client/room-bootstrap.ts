import { getIdentity, type RoomIdentity } from "./use-room";

export interface RelayBootstrap {
  roomID: string;
  controlOrigin: string;
  identity: RoomIdentity;
  resumeState?: {
    draft?: string;
    selectedID?: string;
    mobileTab?: "transcript" | "people" | "queue";
  };
}

export function createThread() {
  const nextRoomID = `session-${crypto.randomUUID()}`;
  window.location.assign(`/r/${nextRoomID}${window.location.search}`);
}

export async function resolveRelayBootstrap(): Promise<RelayBootstrap> {
  const roomMatch = window.location.pathname.match(/^\/r\/([^/]+)/);
  if (!roomMatch) {
    createThread();
    return new Promise<RelayBootstrap>(() => {});
  }
  const roomID = roomMatch[1];
  const params = new URLSearchParams(window.location.search);
  const storedControl = window.sessionStorage.getItem("relay:control-origin");
  const controlOrigin = safeOrigin(
    params.get("control") ?? storedControl ?? window.location.origin,
  );
  window.sessionStorage.setItem("relay:control-origin", controlOrigin);

  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const handoff = fragment.get("handoff");
  if (!handoff) {
    return { roomID, controlOrigin, identity: getIdentity(roomID) };
  }

  const response = await fetch(
    `${controlOrigin}/api/rooms/${encodeURIComponent(roomID)}/handoffs/redeem`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: handoff }),
    },
  );
  const result = (await response.json()) as {
    participant?: RoomIdentity;
    clientState?: RelayBootstrap["resumeState"];
    error?: string;
  };
  if (!response.ok || !result.participant)
    throw new Error(result.error || "Unable to enter the deployed room");

  rememberIdentity(roomID, result.participant);
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
  return {
    roomID,
    controlOrigin,
    identity: result.participant,
    resumeState: result.clientState,
  };
}

function rememberIdentity(roomID: string, identity: RoomIdentity) {
  const storageKey = `relay:${roomID}:${identity.name}:participant`;
  window.localStorage.setItem(storageKey, identity.id);
  window.localStorage.setItem(
    `relay:${roomID}:identity`,
    JSON.stringify(identity),
  );
}

function safeOrigin(value: string): string {
  const url = new URL(value, window.location.origin);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    return window.location.origin;
  return url.origin;
}
