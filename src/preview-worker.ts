import { Hono } from "hono";

// oxlint-disable-next-line eslint/no-underscore-dangle -- Vite injects this build-time constant.
declare const __RELAY_BUILD_SHA__: string;

interface PreviewEnv {
  ASSETS: Fetcher;
  RELAY_CONTROL_ORIGIN: string;
}

interface PreviewBindings {
  Bindings: PreviewEnv;
}

const app = new Hono<PreviewBindings>();

app.get("/__relay/ready", (context) =>
  context.json({
    ready: true,
    commitSHA: __RELAY_BUILD_SHA__,
    roomProtocol: 1,
    controlPlaneOrigin: context.env.RELAY_CONTROL_ORIGIN,
  }),
);

app.all("*", (context) => context.env.ASSETS.fetch(context.req.raw));

export default app;
