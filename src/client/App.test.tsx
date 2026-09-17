// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomInfo } from "../shared/protocol";
import type { RelayBootstrap } from "./room-bootstrap";
import type { RoomState } from "./use-room";
import { App } from "./App";

const harness = vi.hoisted(() => {
  const createPullRequest = vi.fn(async (): Promise<string | undefined> => undefined);
  const ok = () => true;
  return {
    createPullRequest,
    github: {
      state: {
        configured: true,
        authenticated: true,
        loading: false,
        creating: false,
        user: { login: "octocat" },
        error: undefined as string | undefined,
      },
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
    roomState: {
      room: undefined as RoomInfo | undefined,
      models: [] as RoomState["models"],
      participants: [] as RoomState["participants"],
      events: [] as RoomState["events"],
      permissions: [] as RoomState["permissions"],
      queue: [] as RoomState["queue"],
      brief: {
        objective: "",
        constraints: [] as string[],
        validation: [] as string[],
        revision: 0,
        review: { status: "draft" as const, round: 0 },
        reviewComments: [] as RoomState["brief"]["reviewComments"],
      },
      decisions: [] as RoomState["decisions"],
      connection: "connected" as const,
    } satisfies RoomState,
  };
});

vi.mock("./use-github", () => ({
  useGitHub: () => harness.github,
}));

vi.mock("./use-room", () => ({
  useRoom: () => ({
    get state() {
      return harness.roomState;
    },
    actions: harness.actions,
  }),
}));

vi.mock("./use-preview-handoff", () => ({
  usePreviewHandoff: () => ({
    transitioning: false,
    retry: () => {},
  }),
}));

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
  return render(<App bootstrap={bootstrap} />);
}

beforeEach(() => {
  harness.createPullRequest.mockClear();
  harness.github.state.authenticated = true;
  harness.github.state.creating = false;
  harness.github.state.error = undefined;
  harness.roomState.room = unpublishedRoom();
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe("GitHub auto-publish effect", () => {
  it("publishes unpublished idle work once, ignoring unrelated room ticks", () => {
    const { rerender } = renderApp();
    expect(harness.createPullRequest).toHaveBeenCalledTimes(1);

    harness.roomState.room = unpublishedRoom({ title: "Ticked title" });
    rerender(<App bootstrap={bootstrap} />);
    expect(harness.createPullRequest).toHaveBeenCalledTimes(1);
  });

  it("retries the same revision after github.error clears", () => {
    const { rerender } = renderApp();
    expect(harness.createPullRequest).toHaveBeenCalledTimes(1);

    harness.github.state.error = "Pull request creation failed";
    rerender(<App bootstrap={bootstrap} />);
    expect(harness.createPullRequest).toHaveBeenCalledTimes(1);

    harness.github.state.error = undefined;
    rerender(<App bootstrap={bootstrap} />);
    expect(harness.createPullRequest).toHaveBeenCalledTimes(2);
  });

  it("publishes a newer workspace revision even while a previous error is showing", () => {
    const { rerender } = renderApp();
    expect(harness.createPullRequest).toHaveBeenCalledTimes(1);

    harness.github.state.error = "Pull request creation failed";
    rerender(<App bootstrap={bootstrap} />);
    expect(harness.createPullRequest).toHaveBeenCalledTimes(1);

    harness.roomState.room = unpublishedRoom({ workspaceRevision: 3 });
    rerender(<App bootstrap={bootstrap} />);
    expect(harness.createPullRequest).toHaveBeenCalledTimes(2);
  });

  it("does not auto-publish when GitHub still reports an error and nothing has been attempted", () => {
    harness.github.state.error = "Unable to read the GitHub connection";
    renderApp();
    expect(harness.createPullRequest).not.toHaveBeenCalled();
  });
});
