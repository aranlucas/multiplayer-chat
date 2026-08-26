import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClientMessage,
  DeliveryMode,
  Participant,
  PermissionRequest,
  QueuedPrompt,
  RoomInfo,
  ServerMessage,
  TimelineEvent,
} from "../shared/protocol";
import { coalesceTimelineEvents } from "./coalesce-events";

export interface RoomState {
  room?: RoomInfo;
  participants: Participant[];
  events: TimelineEvent[];
  permissions: PermissionRequest[];
  queue: QueuedPrompt[];
  connection: "connecting" | "connected" | "reconnecting" | "offline";
  error?: string;
}

export interface RoomIdentity {
  id: string;
  name: string;
  role: "maintainer" | "contributor";
}

const initialState: RoomState = {
  participants: [],
  events: [],
  permissions: [],
  queue: [],
  connection: "connecting",
};

function appendEvent(events: TimelineEvent[], incoming: TimelineEvent) {
  const existing = events.findIndex((event) => event.id === incoming.id);
  const next = existing < 0
    ? [...events, incoming]
    : events.map((event, index) => index === existing ? incoming : event);
  return coalesceTimelineEvents(next);
}

function deriveQueue(events: TimelineEvent[]): QueuedPrompt[] {
  return events
    .filter((event) => event.kind === "prompt" && event.payload.delivery === "queue" && event.actor)
    .map((event) => ({
      eventID: event.id,
      participant: event.actor!,
      text: String(event.payload.text ?? ""),
      createdAt: event.createdAt,
    }));
}

export function getIdentity(roomID: string): RoomIdentity {
  const params = new URLSearchParams(window.location.search);
  const requestedName = params.get("name")?.trim() || "You";
  const requestedRole = params.get("role") === "contributor" ? "contributor" : "maintainer";
  const storageKey = `relay:${roomID}:${requestedName}:participant`;
  let id = window.localStorage.getItem(storageKey);
  if (!id) {
    id = requestedName === "You" ? crypto.randomUUID() : requestedName.toLowerCase().replace(/[^a-z0-9]/g, "-");
    window.localStorage.setItem(storageKey, id);
  }
  return { id, name: requestedName, role: requestedRole };
}

export function useRoom(roomID: string, identity: RoomIdentity) {
  const [state, setState] = useState<RoomState>(initialState);
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);

  const handleMessage = useCallback((message: ServerMessage) => {
    setState((current) => {
      if (message.type === "snapshot") {
        return {
          ...current,
          room: message.room,
          participants: message.participants,
          events: coalesceTimelineEvents(message.events),
          permissions: message.permissions,
          queue: message.queue,
          connection: "connected",
          error: undefined,
        };
      }
      if (message.type === "event") {
        const events = appendEvent(current.events, message.event);
        return { ...current, events, queue: deriveQueue(events) };
      }
      if (message.type === "presence") return { ...current, participants: message.participants };
      if (message.type === "room") return { ...current, room: message.room };
      if (message.type === "permissions") return { ...current, permissions: message.permissions };
      if (message.type === "error") return { ...current, error: message.message };
      return current;
    });
  }, []);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const params = new URLSearchParams({
        participant: identity.id,
        name: identity.name,
        role: identity.role,
      });
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/rooms/${roomID}/ws?${params}`);
      socketRef.current = socket;
      setState((current) => ({
        ...current,
        connection: retryCountRef.current ? "reconnecting" : "connecting",
      }));

      socket.addEventListener("open", () => {
        retryCountRef.current = 0;
        setState((current) => ({ ...current, connection: "connected", error: undefined }));
      });
      socket.addEventListener("message", (event) => {
        try {
          handleMessage(JSON.parse(event.data as string) as ServerMessage);
        } catch {
          setState((current) => ({ ...current, error: "Received an unreadable room event" }));
        }
      });
      socket.addEventListener("close", () => {
        if (disposed) return;
        retryCountRef.current += 1;
        setState((current) => ({ ...current, connection: "reconnecting" }));
        retryRef.current = window.setTimeout(connect, Math.min(1_000 * 2 ** retryCountRef.current, 10_000));
      });
      socket.addEventListener("error", () => socket.close());
    };

    connect();
    return () => {
      disposed = true;
      if (retryRef.current) window.clearTimeout(retryRef.current);
      socketRef.current?.close(1000, "component unmounted");
    };
  }, [handleMessage, identity.id, identity.name, identity.role, roomID]);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setState((current) => ({ ...current, error: "The room is reconnecting. Your message was not sent." }));
      return false;
    }
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const actions = useMemo(
    () => ({
      prompt(text: string, delivery: DeliveryMode) {
        return send({ type: "prompt", text, delivery, requestID: crypto.randomUUID() });
      },
      reply(requestID: string, reply: "once" | "always" | "reject") {
        return send({ type: "permission.reply", requestID, reply });
      },
      pause() {
        return send({ type: "agent.pause" });
      },
      configureRepository(repository: string, branch: string) {
        return send({ type: "room.configure", repository, branch, requestID: crypto.randomUUID() });
      },
    }),
    [send],
  );

  return { state, actions };
}
