import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { handoffParticipantSchema } from "../src/shared/handoff";

test("independent same-name visitors retain separate identities and shared planning after reload", async ({
  app,
  browser,
  screen,
}) => {
  const room = `audit-${crypto.randomUUID()}`;
  await app.open(`/r/${room}?name=Alice`);
  await expect(screen.getByRole("button", "Edit implementation brief")).toBeVisible();

  await expect(browser.locator(".participant-row")).toHaveCount(1);

  const first = await browser.evaluate((id) => localStorage.getItem(`relay:${id}:identity`), room);

  await screen.getByRole("button", "Edit implementation brief").tap();
  await screen.getByLabel("Objective").fill("Preserve shared planning across reconnects");
  await screen.getByRole("button", "Save brief").tap();
  await expect(
    screen.getByText("Preserve shared planning across reconnects", { exact: true }),
  ).toBeVisible();
  // Simulate an independent visitor's empty storage, retaining the server's room.
  await browser.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await browser.reload();
  await expect(
    screen.getByText("Preserve shared planning across reconnects", { exact: true }),
  ).toBeVisible();

  const second = await browser.evaluate((id) => localStorage.getItem(`relay:${id}:identity`), room);

  expect(handoffParticipantSchema.parse(JSON.parse(second ?? "null")).id).not.toBe(
    handoffParticipantSchema.parse(JSON.parse(first ?? "null")).id,
  );
  await expect(browser.locator(".participant-row")).toHaveCount(2);
  await screen.getByLabel("Ask or steer the agent").fill("Unsent private draft");
  await browser.reload();
  await expect(screen.getByLabel("Ask or steer the agent")).toHaveValue("Unsent private draft");

  const reloaded = await browser.evaluate(
    (id) => localStorage.getItem(`relay:${id}:identity`),
    room,
  );

  expect(reloaded).toBe(second);
  await expect(browser.locator(".participant-row")).toHaveCount(2);
});
