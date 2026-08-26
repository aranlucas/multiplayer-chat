import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { isThreadRoute, resolveRelayBootstrap, startNewThread } from "./room-bootstrap";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

// Landing on the home page (anything that isn't an existing thread URL)
// should open a brand-new thread rather than reusing a default room.
if (!isThreadRoute()) {
  startNewThread();
} else {
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
}
