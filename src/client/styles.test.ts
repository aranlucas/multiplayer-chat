import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "styles.css"), "utf8");

describe("permission and composer leftover CSS", () => {
  it("mutes denied permission cards", () => {
    expect(css).toContain(".permission-card.permission-denied");
    expect(css).not.toContain("permission-rejected");
  });

  it("does not style a removed paperclip through generic composer-tools buttons", () => {
    expect(css).not.toMatch(/\.composer-tools\s*>\s*button/);
    expect(css).toContain(".composer-tools .send-button");
  });
});
