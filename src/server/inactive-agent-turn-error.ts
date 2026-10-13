export class InactiveAgentTurnError extends Error {
  constructor() {
    super("Agent turn is no longer running");
  }
}
