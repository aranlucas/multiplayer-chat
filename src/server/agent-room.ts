import { DurableObject } from "cloudflare:workers";
import { OpenCodeWorkerd } from "@opencode/sdk/workerd";
import { AgentRoomCore } from "./agent-room-core";
import { openCodeConfiguration, type WorkerEnv } from "./opencode";
import { railwayTools } from "./railway-tools";

export { validateHandoffClientState } from "./agent-room-core";

export class AgentRoom extends DurableObject<WorkerEnv> {
  private readonly core: AgentRoomCore;
  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    this.core = new AgentRoomCore(ctx, env, {
      createHost: (sandbox, workspace) =>
        OpenCodeWorkerd.create({
          storage: ctx.storage,
          config: openCodeConfiguration(env),
          plugins: [
            railwayTools({
              sandbox,
              ensureWorkspace: () => workspace.ensureReady(),
              checkpointWorkspace: () => workspace.syncSandboxChanges(),
            }),
          ],
        }),
    });
  }
  initialize(
    ...args: Parameters<AgentRoomCore["initialize"]>
  ): ReturnType<AgentRoomCore["initialize"]> {
    return this.core.initialize(...args);
  }
  createPullRequest(
    ...args: Parameters<AgentRoomCore["createPullRequest"]>
  ): ReturnType<AgentRoomCore["createPullRequest"]> {
    return this.core.createPullRequest(...args);
  }
  publishSavedPullRequest(
    ...args: Parameters<AgentRoomCore["publishSavedPullRequest"]>
  ): ReturnType<AgentRoomCore["publishSavedPullRequest"]> {
    return this.core.publishSavedPullRequest(...args);
  }
  recordDeployment(
    ...args: Parameters<AgentRoomCore["recordDeployment"]>
  ): ReturnType<AgentRoomCore["recordDeployment"]> {
    return this.core.recordDeployment(...args);
  }
  createLocalPreview(
    ...args: Parameters<AgentRoomCore["createLocalPreview"]>
  ): ReturnType<AgentRoomCore["createLocalPreview"]> {
    return this.core.createLocalPreview(...args);
  }
  createHandoff(
    ...args: Parameters<AgentRoomCore["createHandoff"]>
  ): ReturnType<AgentRoomCore["createHandoff"]> {
    return this.core.createHandoff(...args);
  }
  redeemHandoff(
    ...args: Parameters<AgentRoomCore["redeemHandoff"]>
  ): ReturnType<AgentRoomCore["redeemHandoff"]> {
    return this.core.redeemHandoff(...args);
  }
  activateRevision(
    ...args: Parameters<AgentRoomCore["activateRevision"]>
  ): ReturnType<AgentRoomCore["activateRevision"]> {
    return this.core.activateRevision(...args);
  }
  alarm(...args: Parameters<AgentRoomCore["alarm"]>): ReturnType<AgentRoomCore["alarm"]> {
    return this.core.alarm(...args);
  }
  fetch(...args: Parameters<AgentRoomCore["fetch"]>): ReturnType<AgentRoomCore["fetch"]> {
    return this.core.fetch(...args);
  }
  webSocketMessage(
    ...args: Parameters<AgentRoomCore["webSocketMessage"]>
  ): ReturnType<AgentRoomCore["webSocketMessage"]> {
    return this.core.webSocketMessage(...args);
  }
  webSocketClose(
    ...args: Parameters<AgentRoomCore["webSocketClose"]>
  ): ReturnType<AgentRoomCore["webSocketClose"]> {
    return this.core.webSocketClose(...args);
  }
  webSocketError(
    ...args: Parameters<AgentRoomCore["webSocketError"]>
  ): ReturnType<AgentRoomCore["webSocketError"]> {
    return this.core.webSocketError(...args);
  }
}
