import type { RoomInfo } from "../shared/protocol";

export class InactiveAgentTurnError extends Error {
  constructor() {
    super("Agent turn is no longer running");
  }
}

export interface AgentTurn {
  /** Checkpoints may still be saved after pause, until another turn takes ownership. */
  isCurrent: () => boolean;
  /** Timeline events, queued work and publication require an actively running turn. */
  isRunning: () => boolean;
  complete(status: RoomInfo["agentStatus"]): void;
}

/** Owns the durable lease shared by native and simulated room turns. */
export class TurnCoordinator {
  constructor(
    private readonly sql: SqlStorage,
    private readonly notify: () => void,
  ) {}

  start(): AgentTurn {
    this.sql.exec(
      "UPDATE relay_room SET agent_turn_generation = agent_turn_generation + 1, agent_status = 'running' WHERE singleton = 1",
    );
    const generation = this.state().agent_turn_generation;
    const isCurrent = () => this.state().agent_turn_generation === generation;
    const isRunning = () => {
      const state = this.state();
      return state.agent_turn_generation === generation && state.agent_status === "running";
    };
    this.notify();
    return {
      isCurrent,
      isRunning,
      complete: (status) => {
        if (isRunning()) {
          this.sql.exec("UPDATE relay_room SET agent_status = ? WHERE singleton = 1", status);
          this.notify();
        }
      },
    };
  }

  pause(): void {
    // Revoke running rights before waiting for the provider to acknowledge interruption.
    // Keep checkpoint rights so edits made before interruption are not lost.
    this.sql.exec("UPDATE relay_room SET agent_status = 'paused' WHERE singleton = 1");
    this.notify();
  }

  private state() {
    return this.sql
      .exec<{ agent_turn_generation: number; agent_status: RoomInfo["agentStatus"] }>(
        "SELECT agent_turn_generation, agent_status FROM relay_room WHERE singleton = 1",
      )
      .one();
  }
}
