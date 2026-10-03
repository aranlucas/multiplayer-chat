import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_dev, type Unstable_DevWorker } from "wrangler";
import { z } from "zod";
import { parseServerMessage, type ClientMessage, type ServerMessage } from "../shared/protocol";

describe("room Durable Object runtime", () => {
  let worker: Unstable_DevWorker;
  const sockets: WebSocket[] = [];
  beforeAll(async () => {
    worker = await unstable_dev(
      fileURLToPath(new URL("./fixtures/room-worker.ts", import.meta.url)),
      {
        config: fileURLToPath(new URL("./fixtures/room-wrangler.jsonc", import.meta.url)),
        local: true,
        port: 0,
        inspectorPort: 0,
        persist: false,
        logLevel: "error",
        experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
      },
    );
  }, 30_000);
  afterAll(async () => {
    for (const socket of sockets) {
      socket.close();
    }

    await worker?.stop();
  });

  async function participant(id: string) {
    const messages: ServerMessage[] = [];

    const socket = new WebSocket(
      `ws://${worker.address}:${worker.port}/api/rooms/synthetic-room/ws?participant=${id}&name=${id}&role=maintainer`,
    );

    sockets.push(socket);
    socket.addEventListener("message", (event) => {
      messages.push(parseServerMessage(z.string().parse(event.data)));
    });
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Local socket failed")), {
        once: true,
      });
    });
    await waitFor(() => messages.some((message) => message.type === "snapshot"));

    return {
      socket,
      messages,
      send: (message: ClientMessage) => socket.send(JSON.stringify(message)),
    };
  }

  it("shares changes with two participants, reconnects persisted events, and redeems a one-time unsent-draft handoff", async () => {
    const first = await participant("first");
    const second = await participant("second");
    first.send({ type: "room.rename", title: "Synthetic collaborative room" });
    await waitFor(() =>
      second.messages.some(
        (message) =>
          message.type === "room" && message.room.title === "Synthetic collaborative room",
      ),
    );
    first.send({ type: "decision.create", text: "Keep this synthetic decision" });
    await waitFor(() =>
      second.messages.some(
        (message) =>
          message.type === "planning" &&
          message.decisions.some((decision) => decision.text === "Keep this synthetic decision"),
      ),
    );
    second.socket.close();
    const reconnected = await participant("second");
    const snapshot = reconnected.messages.find((message) => message.type === "snapshot");
    expect(snapshot?.type).toBe("snapshot");
    expect(snapshot?.room.title).toBe("Synthetic collaborative room");
    expect(snapshot?.participants.map((person) => person.id).sort()).toEqual(["first", "second"]);
    expect(snapshot?.decisions).toContainEqual(
      expect.objectContaining({ text: "Keep this synthetic decision" }),
    );

    const preview = createServer((_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ready: true, roomProtocol: 1, commitSHA: "synthetic-sha" }));
    });

    await new Promise<void>((resolve) => preview.listen(0, "127.0.0.1", resolve));

    try {
      const address = z.object({ port: z.number() }).parse(preview.address());
      const previewOrigin = `http://127.0.0.1:${address.port}`;

      const publish = await worker.fetch(
        "http://localhost/api/rooms/synthetic-room/local-preview",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ previewURL: previewOrigin, commitSHA: "synthetic-sha" }),
        },
      );

      expect(publish.status).toBe(200);

      const handoff = await worker.fetch("http://localhost/api/rooms/synthetic-room/handoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participant: { id: "second", name: "second", role: "maintainer" },
          currentOrigin: "http://localhost",
          clientState: { draft: "Unsent synthetic draft", mobileTab: "brief" },
        }),
      });

      expect(handoff.status).toBe(200);
      const ticket = z.object({ url: z.string() }).parse(await handoff.json());
      const token = new URLSearchParams(new URL(ticket.url).hash.slice(1)).get("handoff");

      const redeem = () =>
        worker.fetch("http://localhost/api/rooms/synthetic-room/handoffs/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: previewOrigin },
          body: JSON.stringify({ token }),
        });

      const result = await redeem();
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({
        roomID: "synthetic-room",
        participant: { id: "second" },
        clientState: { draft: "Unsent synthetic draft", mobileTab: "brief" },
      });
      expect((await redeem()).status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => preview.close(() => resolve()));
    }
  }, 20_000);
});

async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 5_000;

  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error("Local room did not produce the expected event");
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
