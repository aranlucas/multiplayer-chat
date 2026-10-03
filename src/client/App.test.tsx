// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomInfo } from "../shared/protocol";
import type { RelayBootstrap } from "./room-bootstrap";
import type { RoomState } from "./use-room";
import { App, type AppDependencies } from "./App";
import { draftStorageKey } from "./draft-storage";

const harness = (() => {
  const createPullRequest = vi.fn(async (): Promise<string | undefined> => undefined);
  const ok = () => true;

  const roomState: RoomState = {
    room: undefined,
    models: [],
    participants: [],
    events: [],
    permissions: [],
    queue: [],
    brief: {
      objective: "",
      constraints: [],
      validation: [],
      revision: 0,
      review: { status: "draft" as const, round: 0 },
      reviewComments: [],
    },
    decisions: [],
    connection: "connected" as const,
  };

  const githubState: ReturnType<AppDependencies["useGitHub"]>["state"] = {
    configured: true,
    authenticated: true,
    loading: false,
    creating: false,
    user: { login: "octocat" },
    error: undefined,
  };

  return {
    createPullRequest,
    github: {
      state: githubState,
      connect: vi.fn(),
      createPullRequest,
    },
    actions: {
      prompt: vi.fn(ok),
      reply: vi.fn(ok),
      answerQuestion: vi.fn(ok),
      dismissQuestion: vi.fn(ok),
      pause: vi.fn(ok),
      renameRoom: vi.fn(ok),
      configureRepository: vi.fn(ok),
      configureModel: vi.fn(ok),
      updateBrief: vi.fn(ok),
      createDecision: vi.fn(ok),
      startBriefReview: vi.fn(ok),
      commentOnBrief: vi.fn(ok),
      resolveBriefReview: vi.fn(ok),
    },
    roomState,
  };
})();

const dependencies: AppDependencies = {
  useGitHub: () => harness.github,
  useRoom: () => ({ state: harness.roomState, actions: harness.actions }),
  usePreviewHandoff: () => ({ transitioning: false, error: undefined, retry: () => {} }),
};

const bootstrap: RelayBootstrap = {
  roomID: "room-1",
  controlOrigin: "https://control.example",
  identity: { id: "person-1", name: "QA", role: "maintainer" },
};

function unpublishedRoom(overrides: Partial<RoomInfo> = {}): RoomInfo {
  return {
    id: "room-1",
    title: "Relay",
    titleAuto: true,
    repository: "aranlucas/multiplayer-chat",
    branch: "main",
    workspaceStatus: "ready",
    agentStatus: "idle",
    model: "gpt",
    workspaceRevision: 2,
    publishedWorkspaceRevision: 1,
    autoPublishConfigured: false,
    ...overrides,
  };
}

function renderApp() {
  return render(<App bootstrap={bootstrap} dependencies={dependencies} />);
}

beforeEach(() => {
  harness.createPullRequest.mockClear();
  harness.github.state.authenticated = true;
  harness.github.state.creating = false;
  harness.github.state.error = undefined;
  harness.roomState.room = unpublishedRoom();
  harness.actions.prompt.mockReset().mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("GitHub auto-publish effect", () => {
  it("publishes unpublished idle work once, ignoring unrelated room ticks", () => {
    const { rerender } = renderApp();
    expect(harness.createPullRequest).toHaveBeenCalledTimes(1);

    harness.roomState.room = unpublishedRoom({ title: "Ticked title" });
    rerender(<App bootstrap={bootstrap} dependencies={dependencies} />);
    expect(harness.createPullRequest).toHaveBeenCalledTimes(1);
  });

  it("retries the same revision after github.error clears", () => {
    const { rerender } = renderApp();
    expect(harness.createPullRequest).toHaveBeenCalledTimes(1);

    harness.github.state.error = "Pull request creation failed";
    rerender(<App bootstrap={bootstrap} dependencies={dependencies} />);
    expect(harness.createPullRequest).toHaveBeenCalledTimes(1);

    harness.github.state.error = undefined;
    rerender(<App bootstrap={bootstrap} dependencies={dependencies} />);
    expect(harness.createPullRequest).toHaveBeenCalledTimes(2);
  });

  it("publishes a newer workspace revision even while a previous error is showing", () => {
    const { rerender } = renderApp();
    expect(harness.createPullRequest).toHaveBeenCalledTimes(1);

    harness.github.state.error = "Pull request creation failed";
    rerender(<App bootstrap={bootstrap} dependencies={dependencies} />);
    expect(harness.createPullRequest).toHaveBeenCalledTimes(1);

    harness.roomState.room = unpublishedRoom({ workspaceRevision: 3 });
    rerender(<App bootstrap={bootstrap} dependencies={dependencies} />);
    expect(harness.createPullRequest).toHaveBeenCalledTimes(2);
  });

  it("does not auto-publish when GitHub still reports an error and nothing has been attempted", () => {
    harness.github.state.error = "Unable to read the GitHub connection";
    renderApp();
    expect(harness.createPullRequest).not.toHaveBeenCalled();
  });
});

describe("Unsent room drafts", () => {
  const key = draftStorageKey(bootstrap.controlOrigin, bootstrap.roomID, bootstrap.identity.id);

  it("restores typed text after remount and clears storage after an accepted send", () => {
    const first = renderApp();
    fireEvent.change(screen.getByRole("textbox", { name: "Ask or steer the agent" }), {
      target: { value: "Synthetic unsent draft" },
    });
    first.unmount();
    renderApp();
    expect(screen.getByRole("textbox", { name: "Ask or steer the agent" })).toHaveProperty(
      "value",
      "Synthetic unsent draft",
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(harness.actions.prompt).toHaveBeenCalledWith("Synthetic unsent draft", "steer");
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("retains the draft when the room rejects a send", () => {
    harness.actions.prompt.mockReturnValue(false);
    renderApp();
    fireEvent.change(screen.getByRole("textbox", { name: "Ask or steer the agent" }), {
      target: { value: "Keep on rejected send" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(sessionStorage.getItem(key)).toBe("Keep on rejected send");
  });

  it("isolates stored drafts by control origin, room and participant", () => {
    sessionStorage.setItem(key, "Private synthetic draft");

    for (const other of [
      { ...bootstrap, roomID: "room-2" },
      { ...bootstrap, controlOrigin: "https://other.example" },
      { ...bootstrap, identity: { ...bootstrap.identity, id: "person-2" } },
    ]) {
      const view = render(<App bootstrap={other} dependencies={dependencies} />);
      expect(screen.getByRole("textbox", { name: "Ask or steer the agent" })).toHaveProperty(
        "value",
        "",
      );
      view.unmount();
    }

    expect(sessionStorage.getItem(key)).toBe("Private synthetic draft");
  });

  it("keeps typing in memory and explains recovery when draft storage fails", () => {
    const original = Storage.prototype.setItem.bind(sessionStorage);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((name, value) => {
      if (name.startsWith("relay:draft:")) {
        throw new DOMException("Quota exhausted", "QuotaExceededError");
      }

      original(name, value);
    });
    renderApp();
    fireEvent.change(screen.getByRole("textbox", { name: "Ask or steer the agent" }), {
      target: { value: "Still typing" },
    });
    expect(screen.getByRole("textbox", { name: "Ask or steer the agent" })).toHaveProperty(
      "value",
      "Still typing",
    );
    expect(screen.getByRole("status").textContent).toContain("copy it before reloading");
  });
});
