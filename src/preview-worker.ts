import { Hono } from "hono";

declare const __RELAY_BUILD_SHA__: string;

interface PreviewEnv {
  ASSETS: Fetcher;
  RELAY_CONTROL_ORIGIN: string;
}

const app = new Hono<{ Bindings: PreviewEnv }>();

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
