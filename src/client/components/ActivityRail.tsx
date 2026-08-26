import {
  Bot,
  Check,
  CircleEllipsis,
  GitPullRequest,
  ListFilter,
  Terminal,
  UserRound,
} from "lucide-react";
import type { TimelineEvent } from "../../shared/protocol";
import { displayEvent, formatTime } from "../event-display";

interface ActivityRailProps {
  events: TimelineEvent[];
  selectedID?: string;
  onSelect: (id: string) => void;
}

export function ActivityRail({
  events,
  selectedID,
  onSelect,
}: ActivityRailProps) {
  return (
    <aside className="activity-rail">
      <div className="rail-heading">
        <span>OpenCode session</span>
        <button type="button" aria-label="Filter events">
          <ListFilter size={16} />
        </button>
      </div>
      <div className="activity-list">
        {events.map((event) => {
          const display = displayEvent(event);
          const selected = event.id === selectedID;
          return (
            <button
              className={`activity-row ${selected ? "is-selected" : ""}`}
              key={event.id}
              type="button"
              onClick={() => onSelect(event.id)}
            >
              <span className="activity-time">
                {formatTime(event.createdAt)}
              </span>
              <span className={`activity-icon activity-icon-${display.type}`}>
                {display.type === "prompt" ? (
                  <UserRound size={15} />
                ) : display.type === "tool" ? (
                  <Terminal size={15} />
                ) : display.type === "diff" ? (
                  <GitPullRequest size={15} />
                ) : display.type === "participant" ? (
                  <UserRound size={15} />
                ) : display.type === "reasoning" || display.type === "text" ? (
                  <Bot size={15} />
                ) : (
                  <CircleEllipsis size={15} />
                )}
              </span>
              <span className="activity-content">
                <span className="activity-title">
                  {display.title}
                  {display.type === "prompt" && display.delivery === "queue" ? (
                    <em>Queued</em>
                  ) : null}
                </span>
                <span className="activity-summary">
                  {display.type === "tool"
                    ? display.detail || display.title
                    : display.type === "diff"
                      ? `${display.title}  +${display.additions} −${display.deletions}`
                      : "detail" in display
                        ? display.detail
                        : ""}
                </span>
              </span>
              {display.type === "tool" && display.status === "completed" ? (
                <Check className="activity-check" size={14} />
              ) : null}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
