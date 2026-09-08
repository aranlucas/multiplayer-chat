import { useEffect, useEffectEvent, useState } from "react";
import type { RoomRevision } from "../shared/protocol";
import type { RoomIdentity } from "./use-room";
import type { MobileTab } from "./components/MobileTabs";

interface HandoffOptions {
  roomID: string;
  controlOrigin: string;
  revision?: RoomRevision;
  identity: RoomIdentity;
  draft: string;
  selectedID?: string;
  mobileTab: MobileTab;
}

export function usePreviewHandoff(options: HandoffOptions) {
  const { roomID, controlOrigin, revision } = options;
  const target = revision?.status === "ready" ? revision.previewURL : undefined;
  const revisionID = revision?.id;
  const [attempt, setAttempt] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [error, setError] = useState<string>();
  const snapshot = useEffectEvent(() => {
    const { identity, draft, selectedID, mobileTab } = options;
    setTransitioning(true);
    setError(undefined);
    return { participant: identity, clientState: { draft, selectedID, mobileTab } };
  });

  useEffect(() => {
    // Activation is room-wide, but each participant must move independently.
    if (!target || new URL(target).origin === window.location.origin) {
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function transfer() {
      // Strict Mode may clean up the first effect before this request begins.
      await Promise.resolve();
      if (controller.signal.aborted) {
        return;
      }
      const state = snapshot();
      try {
        const response = await fetch(
          `${controlOrigin}/api/rooms/${encodeURIComponent(roomID)}/handoffs`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...state, currentOrigin: window.location.origin }),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
          },
        );
        const result = (await response.json()) as { url?: string; error?: string };
        if (!response.ok || !result.url) {
          throw new Error(result.error || "Unable to move to the preview");
        }
        if (controller.signal.aborted) {
          return;
        }
        const url = result.url;
        window.sessionStorage.setItem(`relay:${roomID}:draft`, state.clientState.draft);
        window.sessionStorage.setItem(`relay:${roomID}:mobile-tab`, state.clientState.mobileTab);
        if (state.clientState.selectedID) {
          window.sessionStorage.setItem(`relay:${roomID}:selected`, state.clientState.selectedID);
        }
        timer = setTimeout(() => window.location.assign(url), 450);
      } catch (failure) {
        if (controller.signal.aborted) {
          return;
        }
        setTransitioning(false);
        setError(failure instanceof Error ? failure.message : "Preview handoff failed");
      }
    }
    void transfer();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [controlOrigin, roomID, target, revisionID, attempt]);

  return { transitioning, error, retry: () => setAttempt((value) => value + 1) };
}
