// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomRevision } from "../shared/protocol";
import { usePreviewHandoff } from "./use-preview-handoff";

const revision: RoomRevision = {
  id: "revision-2",
  sequence: 2,
  workspaceRevision: 2,
  commitSHA: "abc",
  status: "ready",
  previewURL: "https://preview.example",
  createdAt: 1,
  updatedAt: 1,
};
const options = {
  roomID: "room-1",
  controlOrigin: "https://control.example",
  revision,
  identity: { id: "person-1", name: "QA", role: "maintainer" as const, color: "blue" },
  draft: "Keep this unsent draft",
  mobileTab: "transcript" as const,
  selectedID: "event-1",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("preview handoff", () => {
  it("survives room updates and preserves the draft with one request in Strict Mode", async () => {
    let resolveResponse!: (value: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(response);
    vi.stubGlobal("fetch", fetcher);
    const { result, rerender } = renderHook(usePreviewHandoff, {
      initialProps: options,
      wrapper: StrictMode,
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    rerender({ ...options, revision: { ...revision, activatedAt: 2 } });
    const init = fetcher.mock.calls[0][1];
    expect(init?.signal?.aborted).toBe(false);
    expect(result.current.transitioning).toBe(true);
    expect(JSON.parse(typeof init?.body === "string" ? init.body : "null")).toEqual({
      participant: options.identity,
      currentOrigin: window.location.origin,
      clientState: {
        draft: options.draft,
        selectedID: options.selectedID,
        mobileTab: options.mobileTab,
      },
    });
    await act(async () => {
      resolveResponse(Response.json({ url: "https://preview.example/#handoff=token" }));
    });
    expect(sessionStorage.getItem("relay:room-1:draft")).toBe(options.draft);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("moves a participant even after another participant activated the revision", async () => {
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher);
    renderHook(() => usePreviewHandoff({ ...options, revision: { ...revision, activatedAt: 2 } }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  });

  it("offers a retry after a failed transfer", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => usePreviewHandoff(options));
    await waitFor(() => expect(result.current.error).toBe("Network unavailable"));
    expect(result.current.transitioning).toBe(false);
    act(() => result.current.retry());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(result.current.error).toBeUndefined();
  });

  it("does not transfer again when already on the preview origin", async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    await act(async () => {
      renderHook(() =>
        usePreviewHandoff({
          ...options,
          revision: { ...revision, previewURL: window.location.origin },
        }),
      );
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
