// The regression runtime permits only its local preview readiness server.
const localFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);

  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("External network disabled in room regression worker");
  }

  return localFetch(input, init);
};

export { AgentRoom } from "../agent-room";

export { default } from "../../http-app";
