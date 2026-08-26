import type { RoomInfo } from "../shared/protocol";

export function completedTurnStatus(
  currentGeneration: number,
  completedGeneration: number,
  status: RoomInfo["agentStatus"],
): RoomInfo["agentStatus"] | undefined {
  return currentGeneration === completedGeneration ? status : undefined;
}
