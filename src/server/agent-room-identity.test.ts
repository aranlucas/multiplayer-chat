import { afterEach, describe, expect, it } from "vitest";
import { roomContext, TestRoom } from "./fixtures/room";

const databases: ReturnType<typeof roomContext>["database"][] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

function wokenRoom(name: string | undefined, storedID = name ?? "stored-room") {
  const fixture = roomContext(name);
  fixture.context.id.name = name;
  databases.push(fixture.database);
  const room = new TestRoom(fixture.context);
  room.seed(storedID);
  room.revision({
    workspaceRevision: 0,
    commitSHA: "abc",
    status: "ready",
    previewURL: "https://preview.example/app",
  });

  return { room, ...fixture };
}

describe("Durable Object room identity after hibernation", () => {
  it("keeps the named Durable Object id on handoff without initialize", async () => {
    const { room } = wokenRoom("session-42");

    const result = await room.createHandoff({
      participant: { id: "p1", name: "Maya", role: "maintainer" },
      currentOrigin: "https://control.example",
      controlOrigin: "https://control.example",
    });

    expect(new URL(result.url).pathname).toBe("/r/session-42");
    expect(result.url).not.toContain("reconnect-loop");
  });
  it("tags native OpenCode events with the named Durable Object id after wake", () => {
    const { room, database } = wokenRoom("session-42");
    room.nativeEvent({
      type: "opencode",
      cursor: "7",
      event: { type: "message.updated", data: {} },
    });
    expect(database.sql.exec("SELECT id FROM relay_events").toArray()).toContainEqual({
      id: "opencode:session-42:7",
    });
  });
  it("falls back to the stored room id when the Durable Object is unnamed", async () => {
    const { room } = wokenRoom(undefined);

    const result = await room.createHandoff({
      participant: { id: "p1", name: "Maya", role: "maintainer" },
      currentOrigin: "https://control.example",
      controlOrigin: "https://control.example",
    });

    expect(new URL(result.url).pathname).toBe("/r/stored-room");
  });
});
