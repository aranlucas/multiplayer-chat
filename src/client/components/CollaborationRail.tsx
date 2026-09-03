import { Activity, ChevronDown, Circle, Clock3, UsersRound } from "lucide-react";
import type {
  Participant,
  PermissionRequest,
  QueuedPrompt,
  TimelineEvent,
  ImplementationBrief,
  RoomDecision,
} from "../../shared/protocol";
import { formatTime } from "../event-display";
import { PermissionCard } from "./PermissionCard";
import { ImplementationBrief as ImplementationBriefPanel } from "./ImplementationBrief";

interface CollaborationRailProps {
  participants: Participant[];
  queue: QueuedPrompt[];
  permissions: PermissionRequest[];
  events: TimelineEvent[];
  canApprove: boolean;
  onReply: (id: string, reply: "once" | "reject") => void;
  brief: ImplementationBrief;
  decisions: RoomDecision[];
  selectedEventID?: string;
  onSelectEvent: (id: string) => void;
  onUpdateBrief: (
    brief: Pick<ImplementationBrief, "objective" | "constraints" | "validation">,
  ) => boolean;
  onDecision: (text: string, rationale?: string, sourceEventID?: string) => boolean;
  onStartReview: () => boolean;
  onReviewComment: (text: string) => boolean;
  onResolveReview: (outcome: "approved" | "changes_requested", comment?: string) => boolean;
}

export function CollaborationRail({
  participants,
  queue,
  permissions,
  events,
  canApprove,
  onReply,
  brief,
  decisions,
  selectedEventID,
  onSelectEvent,
  onUpdateBrief,
  onDecision,
  onStartReview,
  onReviewComment,
  onResolveReview,
}: CollaborationRailProps) {
  return (
    <aside className="collaboration-rail">
      <ImplementationBriefPanel
        brief={brief}
        decisions={decisions}
        canEdit={canApprove}
        selectedEventID={selectedEventID}
        onSelectEvent={onSelectEvent}
        onUpdate={onUpdateBrief}
        onDecision={onDecision}
        onStartReview={onStartReview}
        onReviewComment={onReviewComment}
        onResolveReview={onResolveReview}
      />
      <section className="collaboration-section participants-section">
        <h2>
          Participants <span>{participants.length}</span>
        </h2>
        <div className="participant-list">
          {participants.map((participant) => (
            <div className="participant-row" key={participant.id}>
              <span
                className="avatar"
                style={{ "--avatar": participant.color } as React.CSSProperties}
              >
                {participant.name.charAt(0).toUpperCase()}
              </span>
              <span className="participant-name">
                {participant.name}
                <Circle
                  className={participant.online ? "online" : "offline"}
                  size={7}
                  fill="currentColor"
                />
              </span>
              <span className="participant-role">
                {participant.role === "maintainer" ? "Maintainer" : "Contributor"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="collaboration-section queue-section">
        <h2>
          Queue <span>{queue.length}</span>
        </h2>
        {queue.length ? (
          queue.map((item) => (
            <div className="queue-row" key={item.eventID}>
              <span
                className="avatar avatar-small"
                style={{ "--avatar": item.participant.color } as React.CSSProperties}
              >
                {item.participant.name.charAt(0).toUpperCase()}
              </span>
              <div>
                <strong>{item.participant.name}</strong>
                <p>{item.text}</p>
              </div>
              <span className="queue-label">Queued</span>
            </div>
          ))
        ) : (
          <p className="empty-copy">No queued follow-ups.</p>
        )}
      </section>

      <section className="collaboration-section permission-section">
        <h2>
          Permission requests{" "}
          <span>{permissions.filter((permission) => permission.status === "pending").length}</span>
          <ChevronDown size={15} />
        </h2>
        {permissions.slice(0, 2).map((permission) => (
          <PermissionCard
            key={permission.id}
            permission={permission}
            canApprove={canApprove}
            onReply={onReply}
          />
        ))}
      </section>

      <section className="collaboration-section recent-section">
        <h2>
          Recent activity <Activity size={15} />
        </h2>
        {events
          .filter(
            (event) =>
              event.kind === "participant" ||
              event.kind === "permission" ||
              event.kind === "system",
          )
          .slice(-3)
          .reverse()
          .map((event) => (
            <div className="recent-row" key={event.id}>
              <span>{formatTime(event.createdAt)}</span>
              {event.kind === "participant" ? <UsersRound size={14} /> : <Clock3 size={14} />}
              <p>
                {event.kind === "participant"
                  ? `${event.actor?.name ?? "A participant"} joined the session`
                  : event.kind === "permission"
                    ? `${event.actor?.name ?? "Maintainer"} ${String(event.payload.status)} ${String(event.payload.action)}`
                    : String(event.payload.text ?? "Session updated")}
              </p>
            </div>
          ))}
      </section>
    </aside>
  );
}
