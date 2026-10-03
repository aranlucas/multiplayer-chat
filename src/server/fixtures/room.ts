import {
  AgentRoomCore,
  type RoomContext,
  type RoomDependencies,
  type RoomSocket,
} from "../agent-room-core";
import type { RoomEnv } from "../opencode";
import { sqliteStorage } from "./sqlite-storage";

export const simulationEnv: RoomEnv = {
  OPENCODE_MODE: "simulation",
  OPENCODE_PROVIDER: "opencode-zen",
  OPENCODE_MODEL: "opencode/test-model",
  CLOUDFLARE_ACCOUNT_ID: "local-test",
};

export function roomContext(name: string | undefined = "room-1", sockets: RoomSocket[] = []) {
  const database = sqliteStorage();
  const pending: Promise<void>[] = [];

  const context: RoomContext = {
    id: { name },
    storage: { sql: database.sql, setAlarm: async () => {} },
    getWebSockets: () => sockets,
    acceptWebSocket: (socket) => {
      sockets.push(socket);
    },
    waitUntil: (promise) => {
      pending.push(promise);
    },
    blockConcurrencyWhile: (callback) => callback(),
  };

  return { context, database, pending };
}

export class TestRoom extends AgentRoomCore {
  constructor(
    context: RoomContext,
    env: RoomEnv = simulationEnv,
    dependencies: RoomDependencies = {},
  ) {
    super(context, env, dependencies);
  }
  seed(roomID: string) {
    this.ensureRoom(roomID);
  }
  nativeEvent(...args: Parameters<AgentRoomCore["handleNativeRunnerEvent"]>) {
    this.handleNativeRunnerEvent(...args);
  }
  revision(...args: Parameters<AgentRoomCore["insertRevision"]>) {
    return this.insertRevision(...args);
  }
  info() {
    return this.getRoom();
  }
}
