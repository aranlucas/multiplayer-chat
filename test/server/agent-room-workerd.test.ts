import { env, exports } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { afterAll, describe, expect, inject, it } from "vitest";
import { z } from "zod";
import { parseServerMessage, type ClientMessage, type ServerMessage } from "@/shared/protocol";

describe("room Durable Object runtime", () => {
  const sockets: WebSocket[] = [];

  afterAll(() => {
    for (const socket of sockets) {
      socket.close();
    }
  });

  async function participant(id: string) {
    const messages: ServerMessage[] = [];

    const response = await exports.default.fetch(
      `http://localhost/api/rooms/synthetic-room/ws?participant=${id}&name=${id}&role=maintainer`,
      { headers: { Upgrade: "websocket" } },
    );

    expect(response.status).toBe(101);
    const socket = response.webSocket;

    if (!socket) {
      throw new Error("Room did not accept the WebSocket upgrade");
    }

    sockets.push(socket);
    socket.addEventListener("message", (event) => {
      messages.push(parseServerMessage(z.string().parse(event.data)));
    });
    socket.accept();
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
    await evictDurableObject(env.AGENT_ROOMS.getByName("synthetic-room"));
    const reconnected = await participant("second");
    const snapshot = reconnected.messages.find((message) => message.type === "snapshot");
    expect(snapshot?.type).toBe("snapshot");
    expect(snapshot?.room.title).toBe("Synthetic collaborative room");
    expect(snapshot?.participants.map((person) => person.id).toSorted()).toEqual([
      "first",
      "second",
    ]);
    expect(snapshot?.decisions).toContainEqual(
      expect.objectContaining({ text: "Keep this synthetic decision" }),
    );

    const previewOrigin = inject("previewOrigin");

    const mismatched = await exports.default.fetch(
      "http://localhost/api/rooms/synthetic-room/local-preview",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewURL: previewOrigin, commitSHA: "different-sha" }),
      },
    );

    expect(mismatched.status).toBe(400);
    expect(await mismatched.json()).toEqual({
      error: "Preview commit does not match the published revision",
    });

    const publish = await exports.default.fetch(
      "http://localhost/api/rooms/synthetic-room/local-preview",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewURL: previewOrigin, commitSHA: "synthetic-sha" }),
      },
    );

    expect(publish.status).toBe(200);

    const handoff = await exports.default.fetch(
      "http://localhost/api/rooms/synthetic-room/handoffs",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participant: { id: "second", name: "second", role: "maintainer" },
          currentOrigin: "http://localhost",
          clientState: { draft: "Unsent synthetic draft", mobileTab: "brief" },
        }),
      },
    );

    expect(handoff.status).toBe(200);
    const ticket = z.object({ url: z.string() }).parse(await handoff.json());
    const token = new URLSearchParams(new URL(ticket.url).hash.slice(1)).get("handoff");

    const wrongOrigin = await exports.default.fetch(
      "http://localhost/api/rooms/synthetic-room/handoffs/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:1" },
        body: JSON.stringify({ token }),
      },
    );

    expect(wrongOrigin.status).toBe(400);
    expect(await wrongOrigin.json()).toEqual({
      error: "Room handoff ticket was issued for another preview",
    });

    const redeem = () =>
      exports.default.fetch("http://localhost/api/rooms/synthetic-room/handoffs/redeem", {
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
  }, 20_000);
});

async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 5_000;

  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error("Local room did not produce the expected event");
    }

    // oxlint-disable-next-line eslint/no-await-in-loop -- Wait for the next observation without spinning or racing poll attempts.
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}
