import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { resolveRelayBootstrap } from "./room-bootstrap";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

resolveRelayBootstrap()
  .then((bootstrap) => {
    const accent = import.meta.env.VITE_RELAY_ACCENT;
    if (accent) document.documentElement.style.setProperty("--lime", accent);
    document.documentElement.dataset.relayBuild =
      import.meta.env.VITE_RELAY_BUILD ?? "production";
    root.render(
      <StrictMode>
        <App bootstrap={bootstrap} />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    root.render(
      <main className="handoff-error">
        <strong>Unable to enter this Relay preview</strong>
        <p>{error instanceof Error ? error.message : "Room handoff failed"}</p>
        <a href="/">Return to Relay</a>
      </main>,
    );
  });
