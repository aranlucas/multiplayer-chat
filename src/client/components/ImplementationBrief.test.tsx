import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ImplementationBrief as Brief } from "../../shared/protocol";
import { ImplementationBrief } from "./ImplementationBrief";

const reviewer = {
  id: "reviewer-1",
  name: "Maya",
  role: "contributor" as const,
  color: "#488dcc",
};

function render(brief: Brief, canEdit = true) {
  return renderToStaticMarkup(
    <ImplementationBrief
      brief={brief}
      decisions={[]}
      canEdit={canEdit}
      onUpdate={() => true}
      onDecision={() => true}
      onStartReview={() => true}
      onReviewComment={() => true}
      onResolveReview={() => true}
    />,
  );
}

function brief(overrides: Partial<Brief> = {}): Brief {
  return {
    objective: "Ship a plan review workflow",
    constraints: ["Keep the room protocol compatible"],
    validation: ["Review state survives reload"],
    revision: 1,
    review: { status: "draft", round: 0 },
    reviewComments: [],
    ...overrides,
  };
}

describe("ImplementationBrief review", () => {
  it("offers review from a populated draft", () => {
    const html = render(brief());
    expect(html).toContain("Plan review");
    expect(html).toContain("Draft");
    expect(html).toContain("Start review");
  });

  it("renders the in-review actions and durable feedback", () => {
    const html = render(
      brief({
        review: {
          status: "in_review",
          round: 2,
          startedAt: 1,
          startedBy: reviewer,
        },
        reviewComments: [
          {
            id: "comment-1",
            round: 1,
            text: "Add a rollback check.",
            actor: reviewer,
            createdAt: 1,
          },
        ],
      }),
    );
    expect(html).toContain("In review");
    expect(html).toContain("Overall review");
    expect(html).toContain("Approve");
    expect(html).toContain("Request changes");
    expect(html).toContain("Add a rollback check.");
    expect(html).toContain("Review 1");
  });

  it("shows the final reviewer and edit guidance after changes are requested", () => {
    const html = render(
      brief({
        review: {
          status: "changes_requested",
          round: 1,
          startedAt: 1,
          startedBy: reviewer,
          resolvedAt: 2,
          resolvedBy: reviewer,
        },
      }),
    );
    expect(html).toContain("Changes requested");
    expect(html).toContain("Edit the brief to address feedback");
    expect(html).not.toContain("Start review");
  });
});
