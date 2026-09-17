import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ImplementationBrief as Brief, PermissionRequest } from "../../shared/protocol";
import { CollaborationRail } from "./CollaborationRail";

const brief: Brief = {
  objective: "Ship a plan review workflow",
  constraints: ["Keep the room protocol compatible"],
  validation: ["Review state survives reload"],
  revision: 1,
  review: { status: "draft", round: 0 },
  reviewComments: [],
};

const permission: PermissionRequest = {
  id: "perm-1",
  sessionID: "ses_1",
  action: "shell",
  resources: ["src/worker.ts"],
  message: "Run a mutating shell command",
  status: "pending",
  createdAt: 1_700_000_000_000,
};

function permissionHeading(html: string) {
  return html.match(/<h2>\s*Permission requests[\s\S]*?<\/h2>/)?.[0];
}

describe("CollaborationRail permission heading", () => {
  it("does not render a collapse chevron on a non-collapsible heading", () => {
    const html = renderToStaticMarkup(
      <CollaborationRail
        participants={[]}
        queue={[]}
        permissions={[permission]}
        events={[]}
        canApprove
        onReply={() => {}}
        brief={brief}
        decisions={[]}
        onSelectEvent={() => {}}
        onUpdateBrief={() => true}
        onDecision={() => true}
        onStartReview={() => true}
        onReviewComment={() => true}
        onResolveReview={() => true}
      />,
    );
    const heading = permissionHeading(html);

    expect(heading).toBeDefined();
    expect(heading).toContain("Permission requests");
    expect(heading).not.toContain("lucide-chevron-down");
    expect(html).toContain("Run a mutating shell command");
  });
});
