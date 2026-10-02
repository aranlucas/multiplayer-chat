import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnCoordinator } from "./agent-turn";
import { sqliteStorage } from "./fixtures/sqlite-storage";

const databases: ReturnType<typeof sqliteStorage>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

function coordinator() {
  const database = sqliteStorage();
  databases.push(database);
  database.sql
    .exec(`CREATE TABLE relay_room (singleton INTEGER PRIMARY KEY, agent_turn_generation INTEGER, agent_status TEXT);
    INSERT INTO relay_room VALUES (1, 0, 'idle');`);
  const notify = vi.fn();
  return {
    coordinator: new TurnCoordinator(database.sql, notify),
    restart: () => new TurnCoordinator(database.sql, notify),
    status: () =>
      database.sql.exec<{ agent_status: string }>("SELECT agent_status FROM relay_room").one()
        .agent_status,
  };
}

describe("TurnCoordinator", () => {
  it("keeps the newer turn running when an old turn completes last", () => {
    const fixture = coordinator();
    const older = fixture.coordinator.start();
    const newer = fixture.coordinator.start();
    older.complete("error");
    expect(fixture.status()).toBe("running");
    expect(older.isCurrent()).toBe(false);
    expect(newer.isRunning()).toBe(true);
    newer.complete("idle");
    older.complete("error");
    expect(fixture.status()).toBe("idle");
  });

  it("revokes running rights on pause but preserves checkpoint ownership", () => {
    const fixture = coordinator();
    const turn = fixture.coordinator.start();
    fixture.coordinator.pause();
    expect(turn.isCurrent()).toBe(true);
    expect(turn.isRunning()).toBe(false);
    turn.complete("idle");
    turn.complete("error");
    expect(fixture.status()).toBe("paused");
    fixture.coordinator.start();
    expect(turn.isCurrent()).toBe(false);
  });

  it("uses durable generation state across a coordinator restart", () => {
    const fixture = coordinator();
    const older = fixture.coordinator.start();
    const newer = fixture.restart().start();
    older.complete("idle");
    expect(newer.isRunning()).toBe(true);
    newer.complete("error");
    expect(fixture.status()).toBe("error");
  });
});
