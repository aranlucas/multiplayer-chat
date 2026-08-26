import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDotDashed,
  Copy,
  GitPullRequest,
  LoaderCircle,
  Terminal,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PermissionRequest, TimelineEvent } from "../../shared/protocol";
import { displayEvent, formatTime } from "../event-display";
import { PermissionCard } from "./PermissionCard";

interface TranscriptProps {
  events: TimelineEvent[];
  selectedID?: string;
  pendingPermission?: PermissionRequest;
  canApprove: boolean;
  onReply: (id: string, reply: "once" | "reject") => void;
}

export function Transcript({
  events,
  selectedID,
  pendingPermission,
  canApprove,
  onReply,
}: TranscriptProps) {
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedID)
      selectedRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
  }, [selectedID]);

  return (
    <section className="transcript" aria-label="Agent session transcript">
      <div className="transcript-scroll">
        <div className="transcript-inner">
          {events.map((event) => (
            <TranscriptEvent
              event={event}
              key={event.id}
              selected={event.id === selectedID}
              elementRef={event.id === selectedID ? selectedRef : undefined}
            />
          ))}
          {pendingPermission ? (
            <div className="mobile-inline-permission">
              <PermissionCard
                permission={pendingPermission}
                canApprove={canApprove}
                onReply={onReply}
                compact
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function TranscriptEvent({
  event,
  selected,
  elementRef,
}: {
  event: TimelineEvent;
  selected: boolean;
  elementRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const display = displayEvent(event);

  if (display.type === "tool") {
    return (
      <ToolEvent event={event} selected={selected} elementRef={elementRef} />
    );
  }

  return (
    <div
      className={`transcript-event event-${display.type} ${selected ? "is-selected" : ""}`}
      ref={elementRef}
    >
      <div className="event-gutter">
        <span className="event-time">{formatTime(event.createdAt)}</span>
        <span className="event-marker">
          {display.type === "prompt" ? (
            <UserRound size={17} />
          ) : display.type === "reasoning" || display.type === "text" ? (
            <Bot size={17} />
          ) : display.type === "diff" ? (
            <GitPullRequest size={17} />
          ) : (
            <CircleDotDashed size={17} />
          )}
        </span>
      </div>
      <div className="event-body">
        <div className="event-heading">
          <strong>{display.title}</strong>
          {display.type === "prompt" && display.delivery === "queue" ? (
            <span className="queue-label">Queued</span>
          ) : null}
          {display.type === "reasoning" && display.streaming ? (
            <LoaderCircle className="spin" size={14} />
          ) : null}
        </div>
        {display.type === "diff" ? (
          <div className="diff-summary">
            <span>{display.title}</span>
            <b>+{display.additions}</b>
            <em>−{display.deletions}</em>
          </div>
        ) : (
          <p>{"detail" in display ? display.detail : ""}</p>
        )}
      </div>
    </div>
  );
}

function ToolEvent({
  event,
  selected,
  elementRef,
}: {
  event: TimelineEvent;
  selected: boolean;
  elementRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const display = displayEvent(event);
  if (display.type !== "tool") return null;
  const [expanded, setExpanded] = useState(Boolean(display.output));
  const [copied, setCopied] = useState(false);
  const successful = display.status === "completed";
  const command = display.command;
  const copyable = successful && Boolean(command);

  async function copyCommand() {
    if (!command) return;
    try {
      await copyText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className={`transcript-event event-tool ${selected ? "is-selected" : ""}`}
      ref={elementRef}
    >
      <div className="event-gutter">
        <span className="event-time">{formatTime(event.createdAt)}</span>
        <span className="event-marker">
          <Terminal size={17} />
        </span>
      </div>
      <div className="event-body tool-event-body">
        <div className="tool-header-wrap">
          <button
            className="tool-header"
            type="button"
            onClick={() => setExpanded((value) => !value)}
          >
            <Terminal size={15} />
            <code>{display.title}</code>
            <span className="tool-spacer" />
            {display.status === "running" ? (
              <LoaderCircle className="spin" size={15} />
            ) : null}
            {successful ? <Check className="tool-success" size={16} /> : null}
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          {copyable ? (
            <button
              className="tool-copy"
              type="button"
              onClick={copyCommand}
              aria-label={copied ? "Copied command" : "Copy command"}
              title={copied ? "Copied" : "Copy command"}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          ) : null}
        </div>
        {display.detail ? (
          <div className="tool-summary">{display.detail}</div>
        ) : null}
        {expanded && display.output ? (
          <pre className="tool-output">{display.output}</pre>
        ) : null}
      </div>
    </div>
  );
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Clipboard copy was rejected");
  }
}
