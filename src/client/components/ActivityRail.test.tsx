import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../../shared/protocol";
import { ActivityRail } from "./ActivityRail";

const prompt: TimelineEvent = {
  seq: 1,
  id: "event-1",
  kind: "prompt",
  createdAt: 1,
  actor: { id: "p1", name: "Maya", role: "maintainer", color: "#fff" },
  payload: { text: "Inspect the reconnect loop", delivery: "steer" },
};

describe("ActivityRail", () => {
  it("lists session events without a leftover filter control", () => {
    const html = renderToStaticMarkup(
      <ActivityRail events={[prompt]} selectedID="event-1" onSelect={() => {}} />,
    );
    expect(html).toContain("OpenCode session");
    expect(html).toContain("Inspect the reconnect loop");
    expect(html).not.toContain("Filter events");
  });
});
