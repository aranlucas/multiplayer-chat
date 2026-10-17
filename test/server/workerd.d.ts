import type roomWorker from "./fixtures/room-worker";
import type sdkWorker from "./fixtures/opencode-worker";

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: { default: typeof roomWorker | typeof sdkWorker };
    }

    interface Env {
      AGENT_ROOMS: DurableObjectNamespace;
    }
  }
}

declare module "vitest" {
  interface ProvidedContext {
    previewOrigin: string;
  }
}
