import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OpenCodeModelOption, RoomInfo } from "../../shared/protocol";
import { Header } from "./Header";

const room: RoomInfo = {
  id: "room-1",
  title: "Investigate reconnect loop",
  titleAuto: false,
  repository: "aranlucas/multiplayer-chat",
  branch: "feature/reconnect",
  workspaceStatus: "ready",
  agentStatus: "idle",
  model: "anthropic/claude",
  workspaceRevision: 1,
  publishedWorkspaceRevision: 1,
  autoPublishConfigured: false,
};

const models: OpenCodeModelOption[] = [
  { id: "anthropic/claude", name: "Claude", providerID: "anthropic", free: false },
];

function renderHeader() {
  return renderToStaticMarkup(
    <Header
      room={room}
      models={models}
      participants={[]}
      connection="connected"
      githubConfigured
      creatingPullRequest={false}
      onPullRequest={() => {}}
      onNewThread={() => {}}
      onPause={() => {}}
      canConfigure
      onConfigure={() => true}
      onConfigureModel={() => true}
      onRenameRoom={() => true}
    />,
  );
}

function branchContext(html: string) {
  return html.match(/<div class="header-context branch-context">[\s\S]*?<\/div>/)?.[0];
}

describe("Header branch context", () => {
  it("shows the branch as read-only chrome without a disclosure chevron", () => {
    const html = renderHeader();
    const branch = branchContext(html);

    expect(branch).toBeDefined();
    expect(branch).toContain("feature/reconnect");
    expect(branch).not.toContain("lucide-chevron-down");
    expect(html).not.toMatch(/<button[^>]*branch-context/);
    expect(html).toContain("lucide-chevron-down");
  });
});
