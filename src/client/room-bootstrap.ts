import { z } from "zod";
import { getIdentity, rememberIdentity, roomIdentitySchema, type RoomIdentity } from "./use-room";

export interface RelayBootstrap {
  roomID: string;
  controlOrigin: string;
  identity: RoomIdentity;
  resumeState?: {
    draft?: string;
    selectedID?: string;
    mobileTab?: "transcript" | "brief" | "people" | "queue";
  };
}

export function createThread() {
  const nextRoomID = `session-${crypto.randomUUID()}`;
  window.location.assign(`/r/${nextRoomID}${window.location.search}`);
}

export async function resolveRelayBootstrap(): Promise<RelayBootstrap> {
  const roomID = window.location.pathname.match(/^\/r\/([^/]+)/)?.[1] ?? "reconnect-loop";
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

  const result = z
    .object({
      participant: roomIdentitySchema.optional(),
      clientState: z
        .object({
          draft: z.string().optional(),
          selectedID: z.string().optional(),
          mobileTab: z.enum(["transcript", "brief", "people", "queue"]).optional(),
        })
        .optional(),
      error: z.string().optional(),
    })
    .parse(await response.json());

  if (!response.ok || !result.participant) {
    throw new Error(result.error || "Unable to enter the deployed room");
  }

  rememberIdentity(roomID, result.participant);
  rememberClientState(roomID, result.clientState);
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);

  return {
    roomID,
    controlOrigin,
    identity: result.participant,
    resumeState: result.clientState,
  };
}

function rememberClientState(roomID: string, state: RelayBootstrap["resumeState"]) {
  if (!state) {
    return;
  }

  if (state.draft !== undefined) {
    window.sessionStorage.setItem(`relay:${roomID}:draft`, state.draft);
  }

  if (state.selectedID !== undefined) {
    window.sessionStorage.setItem(`relay:${roomID}:selected`, state.selectedID);
  }

  if (
    state.mobileTab === "transcript" ||
    state.mobileTab === "brief" ||
    state.mobileTab === "people" ||
    state.mobileTab === "queue"
  ) {
    window.sessionStorage.setItem(`relay:${roomID}:mobile-tab`, state.mobileTab);
  }
}

function safeOrigin(value: string): string {
  const url = new URL(value, window.location.origin);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";

  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    return window.location.origin;
  }

  return url.origin;
}
