import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queuedPrompts } from "../shared/protocol";
import type {
  ClientMessage,
  DeliveryMode,
  Participant,
  ImplementationBrief,
  OpenCodeModelOption,
  PermissionRequest,
  QueuedPrompt,
  RoomInfo,
  RoomDecision,
  ServerMessage,
  TimelineEvent,
} from "../shared/protocol";
import { coalesceTimelineEvents } from "./coalesce-events";

export interface RoomState {
  room?: RoomInfo;
  models: OpenCodeModelOption[];
  participants: Participant[];
  events: TimelineEvent[];
  permissions: PermissionRequest[];
  queue: QueuedPrompt[];
  brief: ImplementationBrief;
  decisions: RoomDecision[];
  connection: "connecting" | "connected" | "reconnecting" | "offline";
  error?: string;
}

export interface RoomIdentity {
  id: string;
  name: string;
  role: "maintainer" | "contributor";
}

const initialState: RoomState = {
  models: [],
  participants: [],
  events: [],
  permissions: [],
  queue: [],
  brief: {
    objective: "",
    constraints: [],
    validation: [],
    revision: 0,
    review: { status: "draft", round: 0 },
    reviewComments: [],
  },
  decisions: [],
  connection: "connecting",
};

function appendEvent(events: TimelineEvent[], incoming: TimelineEvent) {
  const existing = events.findIndex((event) => event.id === incoming.id);
  const next =
    existing < 0
      ? [...events, incoming]
      : events.map((event, index) => (index === existing ? incoming : event));
  return coalesceTimelineEvents(next);
}

export function getIdentity(roomID: string): RoomIdentity {
  const params = new URLSearchParams(window.location.search);
  const remembered = rememberedIdentity(roomID);
  const requestedName = params.get("name")?.trim() || remembered?.name || "You";
  const requestedRole = params.has("role")
    ? params.get("role") === "contributor"
      ? "contributor"
      : "maintainer"
    : (remembered?.role ?? "maintainer");
  const storageKey = `relay:${roomID}:${requestedName}:participant`;
  let id = window.localStorage.getItem(storageKey);
  if (!id) {
    id =
      requestedName === "You"
        ? crypto.randomUUID()
        : requestedName.toLowerCase().replace(/[^a-z0-9]/g, "-");
    window.localStorage.setItem(storageKey, id);
  }
  const identity = { id, name: requestedName, role: requestedRole };
  window.localStorage.setItem(`relay:${roomID}:identity`, JSON.stringify(identity));
  return identity;
}

function rememberedIdentity(roomID: string): RoomIdentity | undefined {
  try {
    const value = window.localStorage.getItem(`relay:${roomID}:identity`);
    if (!value) return undefined;
    const identity = JSON.parse(value) as Partial<RoomIdentity>;
    if (
      typeof identity.id === "string" &&
      typeof identity.name === "string" &&
      (identity.role === "maintainer" || identity.role === "contributor")
    )
      return identity as RoomIdentity;
  } catch {
    // Ignore malformed local identity state.
  }
  return undefined;
}

export function useRoom(
  roomID: string,
  identity: RoomIdentity,
  controlOrigin = window.location.origin,
) {
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
          models: message.models,
          participants: message.participants,
          events: coalesceTimelineEvents(message.events),
          permissions: message.permissions,
          queue: message.queue,
          brief: message.brief,
          decisions: message.decisions,
          connection: "connected",
          error: undefined,
        };
      }
      if (message.type === "event") {
        const events = appendEvent(current.events, message.event);
        return { ...current, events, queue: queuedPrompts(events) };
      }
      if (message.type === "presence") return { ...current, participants: message.participants };
      if (message.type === "room") return { ...current, room: message.room };
      if (message.type === "permissions") return { ...current, permissions: message.permissions };
      if (message.type === "planning")
        return {
          ...current,
          brief: message.brief,
          decisions: message.decisions,
        };
      if (message.type === "error") return { ...current, error: message.message };
      return current;
    });
  }, []);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      const endpoint = new URL(controlOrigin);
      const protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
      const params = new URLSearchParams({
        participant: identity.id,
        name: identity.name,
        role: identity.role,
      });
      const socket = new WebSocket(
        `${protocol}//${endpoint.host}/api/rooms/${roomID}/ws?${params}`,
      );
      socketRef.current = socket;
      setState((current) => ({
        ...current,
        connection: retryCountRef.current ? "reconnecting" : "connecting",
      }));

      socket.addEventListener("open", () => {
        retryCountRef.current = 0;
        setState((current) => ({
          ...current,
          connection: "connected",
          error: undefined,
        }));
      });
      socket.addEventListener("message", (event) => {
        try {
          handleMessage(JSON.parse(event.data as string) as ServerMessage);
        } catch {
          setState((current) => ({
            ...current,
            error: "Received an unreadable room event",
          }));
        }
      });
      socket.addEventListener("close", () => {
        if (disposed) return;
        retryCountRef.current += 1;
        setState((current) => ({ ...current, connection: "reconnecting" }));
        retryRef.current = window.setTimeout(
          connect,
          Math.min(1_000 * 2 ** retryCountRef.current, 10_000),
        );
      });
      socket.addEventListener("error", () => socket.close());
    };

    connect();
    return () => {
      disposed = true;
      if (retryRef.current) window.clearTimeout(retryRef.current);
      socketRef.current?.close(1000, "component unmounted");
    };
  }, [controlOrigin, handleMessage, identity.id, identity.name, identity.role, roomID]);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setState((current) => ({
        ...current,
        error: "The room is reconnecting. Your message was not sent.",
      }));
      return false;
    }
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const actions = useMemo(
    () => ({
      prompt(text: string, delivery: DeliveryMode) {
        return send({
          type: "prompt",
          text,
          delivery,
          requestID: crypto.randomUUID(),
        });
      },
      reply(requestID: string, reply: "once" | "always" | "reject") {
        return send({ type: "permission.reply", requestID, reply });
      },
      answerQuestion(sessionID: string, formID: string, answer: Record<string, string | string[]>) {
        return send({
          type: "question.reply",
          sessionID,
          formID,
          answer,
          requestID: crypto.randomUUID(),
        });
      },
      dismissQuestion(sessionID: string, formID: string) {
        return send({
          type: "question.cancel",
          sessionID,
          formID,
          requestID: crypto.randomUUID(),
        });
      },
      pause() {
        return send({ type: "agent.pause" });
      },
      renameRoom(title: string) {
        return send({
          type: "room.rename",
          title,
          requestID: crypto.randomUUID(),
        });
      },
      configureRepository(repository: string, branch: string) {
        return send({
          type: "room.configure",
          repository,
          branch,
          requestID: crypto.randomUUID(),
        });
      },
      configureModel(model: string) {
        return send({
          type: "room.model.configure",
          model,
          requestID: crypto.randomUUID(),
        });
      },
      updateBrief(brief: Pick<ImplementationBrief, "objective" | "constraints" | "validation">) {
        return send({
          type: "brief.update",
          ...brief,
          requestID: crypto.randomUUID(),
        });
      },
      createDecision(text: string, rationale?: string, sourceEventID?: string) {
        return send({
          type: "decision.create",
          text,
          rationale,
          sourceEventID,
          requestID: crypto.randomUUID(),
        });
      },
      startBriefReview() {
        return send({
          type: "brief.review.start",
          requestID: crypto.randomUUID(),
        });
      },
      commentOnBrief(text: string) {
        return send({
          type: "brief.review.comment",
          text,
          requestID: crypto.randomUUID(),
        });
      },
      resolveBriefReview(outcome: "approved" | "changes_requested", comment?: string) {
        return send({
          type: "brief.review.resolve",
          outcome,
          comment,
          requestID: crypto.randomUUID(),
        });
      },
    }),
    [send],
  );

  return { state, actions };
}
