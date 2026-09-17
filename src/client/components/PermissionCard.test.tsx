import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PermissionRequest } from "../../shared/protocol";
import { PermissionCard } from "./PermissionCard";

function permission(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: "perm-1",
    sessionID: "ses_1",
    action: "shell",
    resources: ["src/worker.ts", "wrangler.json"],
    message: "Run a mutating shell command",
    status: "pending",
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function render(request: PermissionRequest, compact = false) {
  return renderToStaticMarkup(
    <PermissionCard permission={request} canApprove compact={compact} onReply={() => {}} />,
  );
}

describe("PermissionCard", () => {
  it("renders the real message and resources instead of fake production chrome", () => {
    const html = render(permission());
    expect(html).toContain("Run a mutating shell command");
    expect(html).toContain("src/worker.ts");
    expect(html).toContain("wrangler.json");
    expect(html).not.toContain("--env production");
    expect(html).not.toContain("$ shell");
  });

  it("omits resource chrome when OpenCode did not name any", () => {
    const html = render(permission({ resources: [], message: undefined }));
    expect(html).toContain("This side effect needs maintainer approval.");
    expect(html).not.toContain("<code>");
    expect(html).not.toContain("--env production");
  });

  it("keeps compact cards to action and reply controls", () => {
    const html = render(permission(), true);
    expect(html).toContain("shell");
    expect(html).not.toContain("Run a mutating shell command");
    expect(html).not.toContain("src/worker.ts");
    expect(html).toContain("Approve");
    expect(html).not.toContain("Deny");
  });

  it("applies permission-denied so muted CSS matches denied cards", () => {
    const html = render(permission({ status: "denied" }));
    expect(html).toContain("permission-denied");
    expect(html).not.toContain("permission-rejected");
  });
});
