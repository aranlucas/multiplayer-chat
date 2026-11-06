// Browser CI exercises offline room collaboration; external repository/model services are excluded.
// oxlint-disable-next-line eslint/require-await -- Preserve fetch's rejected-promise contract for blocked external requests.
globalThis.fetch = async () => {
  throw new Error("External network disabled in browser regression worker");
};

export { AgentRoom } from "../src/server/agent-room";

export { default } from "../src/http-app";
