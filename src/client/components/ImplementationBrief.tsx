import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  ListChecks,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  ThumbsUp,
  X,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import type { ImplementationBrief as Brief, RoomDecision } from "../../shared/protocol";
import { formatTime } from "../event-display";

interface ImplementationBriefProps {
  brief: Brief;
  decisions: RoomDecision[];
  canEdit: boolean;
  selectedEventID?: string;
  onSelectEvent?: (id: string) => void;
  onUpdate: (brief: Pick<Brief, "objective" | "constraints" | "validation">) => boolean;
  onDecision: (text: string, rationale?: string, sourceEventID?: string) => boolean;
  onStartReview: () => boolean;
  onReviewComment: (text: string) => boolean;
  onResolveReview: (outcome: "approved" | "changes_requested", comment?: string) => boolean;
  mobile?: boolean;
}

export function ImplementationBrief({
  brief,
  decisions,
  canEdit,
  selectedEventID,
  onSelectEvent,
  onUpdate,
  onDecision,
  onStartReview,
  onReviewComment,
  onResolveReview,
  mobile = false,
}: ImplementationBriefProps) {
  const [editing, setEditing] = useState(false);
  const [addingDecision, setAddingDecision] = useState(false);
  const [objective, setObjective] = useState(brief.objective);
  const [constraints, setConstraints] = useState(brief.constraints.join("\n"));
  const [validation, setValidation] = useState(brief.validation.join("\n"));
  const [decision, setDecision] = useState("");
  const [rationale, setRationale] = useState("");

  function beginEditing() {
    setObjective(brief.objective);
    setConstraints(brief.constraints.join("\n"));
    setValidation(brief.validation.join("\n"));
    setEditing(true);
  }

  function saveBrief(event: FormEvent) {
    event.preventDefault();
    if (
      onUpdate({
        objective: objective.trim(),
        constraints: lines(constraints),
        validation: lines(validation),
      })
    )
      setEditing(false);
  }

  function saveDecision(event: FormEvent) {
    event.preventDefault();
    if (onDecision(decision.trim(), rationale.trim() || undefined, selectedEventID)) {
      setDecision("");
      setRationale("");
      setAddingDecision(false);
    }
  }

  return (
    <section
      className={`implementation-brief ${mobile ? "implementation-brief-mobile" : "collaboration-section"}`}
    >
      <div className="brief-heading">
        <h2>
          Implementation brief <span>{decisions.length}</span>
        </h2>
        {canEdit && !editing ? (
          <button
            type="button"
            className="brief-icon-button"
            onClick={beginEditing}
            aria-label="Edit implementation brief"
            title="Edit implementation brief"
          >
            <Pencil size={14} />
          </button>
        ) : null}
      </div>

      {editing ? (
        <form className="brief-form" onSubmit={saveBrief}>
          <label>
            Objective
            <textarea
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              maxLength={4_000}
              placeholder="What should this room accomplish?"
            />
          </label>
          <label>
            Constraints <small>One per line</small>
            <textarea
              value={constraints}
              onChange={(event) => setConstraints(event.target.value)}
              placeholder="Preserve backwards compatibility"
            />
          </label>
          <label>
            Validation <small>One check per line</small>
            <textarea
              value={validation}
              onChange={(event) => setValidation(event.target.value)}
              placeholder="Reconnect test passes"
            />
          </label>
          <div className="brief-form-actions">
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit">Save brief</button>
          </div>
        </form>
      ) : (
        <div className="brief-content">
          {brief.objective ? (
            <p className="brief-objective">{brief.objective}</p>
          ) : (
            <p className="empty-copy">
              {canEdit
                ? "Add the objective and checks that should guide this room."
                : "No implementation brief yet."}
            </p>
          )}
          <BriefList title="Constraints" items={brief.constraints} />
          <BriefList title="Validation" items={brief.validation} checks />
          {brief.updatedBy ? (
            <small className="brief-updated">
              Updated by {brief.updatedBy.name} · {formatTime(brief.updatedAt!)}
            </small>
          ) : null}
        </div>
      )}

      <ReviewPanel
        key={`${brief.review.status}:${brief.review.round}`}
        brief={brief}
        canEdit={canEdit}
        onStartReview={onStartReview}
        onReviewComment={onReviewComment}
        onResolveReview={onResolveReview}
      />

      <div className="decision-heading">
        <strong>Decisions</strong>
        {canEdit && !addingDecision ? (
          <button type="button" onClick={() => setAddingDecision(true)}>
            <Plus size={13} /> Record
          </button>
        ) : null}
      </div>

      {addingDecision ? (
        <form className="decision-form" onSubmit={saveDecision}>
          <button
            className="decision-close"
            type="button"
            aria-label="Cancel decision"
            onClick={() => setAddingDecision(false)}
          >
            <X size={14} />
          </button>
          <label>
            Decision
            <textarea
              value={decision}
              onChange={(event) => setDecision(event.target.value)}
              maxLength={2_000}
              required
            />
          </label>
          <label>
            Why? <small>Optional</small>
            <textarea
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              maxLength={4_000}
            />
          </label>
          {selectedEventID ? (
            <span className="decision-link-note">
              <Link2 size={12} /> Linked to selected timeline event
            </span>
          ) : null}
          <button className="decision-save" type="submit">
            Record decision
          </button>
        </form>
      ) : null}

      <div className="decision-list">
        {decisions.map((item) => (
          <article className="decision-card" key={item.id}>
            <div className="decision-meta">
              <span
                className="avatar avatar-small"
                style={{ "--avatar": item.actor.color } as React.CSSProperties}
              >
                {item.actor.name.charAt(0).toUpperCase()}
              </span>
              <span>{item.actor.name}</span>
              <time>{formatTime(item.createdAt)}</time>
            </div>
            <p>{item.text}</p>
            {item.rationale ? <small>{item.rationale}</small> : null}
            {item.sourceEventID && onSelectEvent ? (
              <button
                className="decision-source"
                type="button"
                onClick={() => onSelectEvent(item.sourceEventID!)}
              >
                <Link2 size={12} /> View source
              </button>
            ) : null}
          </article>
        ))}
        {!decisions.length ? <p className="empty-copy">No decisions recorded yet.</p> : null}
      </div>
    </section>
  );
}

function ReviewPanel({
  brief,
  canEdit,
  onStartReview,
  onReviewComment,
  onResolveReview,
}: Pick<
  ImplementationBriefProps,
  "brief" | "canEdit" | "onStartReview" | "onReviewComment" | "onResolveReview"
>) {
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | undefined>();

  function saveComment(event: FormEvent) {
    event.preventDefault();
    const text = feedback.trim();
    if (!text) {
      setError("Write feedback before commenting.");
      return;
    }
    if (onReviewComment(text)) {
      setFeedback("");
      setError(undefined);
    }
  }

  function resolve(outcome: "approved" | "changes_requested") {
    const comment = feedback.trim();
    if (outcome === "changes_requested" && !comment) {
      setError("Describe the changes you are requesting.");
      return;
    }
    if (onResolveReview(outcome, comment || undefined)) {
      setFeedback("");
      setError(undefined);
    }
  }

  return (
    <div className="brief-review">
      <div className="review-heading">
        <strong>Plan review</strong>
        <span className={`review-status review-status-${brief.review.status}`}>
          {reviewStatusLabel(brief.review.status)}
        </span>
      </div>

      {brief.review.status === "draft" ? (
        <div className="review-callout">
          <p>Share the plan for feedback before implementation begins.</p>
          <button type="button" disabled={!brief.objective} onClick={onStartReview}>
            <Play size={12} /> Start review
          </button>
        </div>
      ) : brief.review.status === "in_review" ? (
        <form className="review-form" onSubmit={saveComment}>
          <ReviewMeta brief={brief} />
          <label>
            Overall review
            <textarea
              value={feedback}
              onChange={(event) => {
                setFeedback(event.target.value);
                setError(undefined);
              }}
              maxLength={4_000}
              placeholder="What should change, or why is this ready?"
            />
          </label>
          {error ? <small className="review-error">{error}</small> : null}
          <div className="review-actions">
            <button type="button" className="review-approve" onClick={() => resolve("approved")}>
              <ThumbsUp size={12} /> Approve
            </button>
            <button
              type="button"
              className="review-request-changes"
              onClick={() => resolve("changes_requested")}
            >
              <AlertTriangle size={12} /> Request changes
            </button>
            <button type="submit">
              <MessageSquare size={12} /> Comment
            </button>
          </div>
        </form>
      ) : (
        <div className="review-result">
          {brief.review.status === "approved" ? (
            <CheckCircle2 size={14} />
          ) : (
            <AlertTriangle size={14} />
          )}
          <div>
            <strong>
              {brief.review.status === "approved" ? "Plan approved" : "Changes requested"}
            </strong>
            <ReviewMeta brief={brief} />
            {brief.review.status === "changes_requested" && canEdit ? (
              <small>Edit the brief to address feedback and begin a new review.</small>
            ) : null}
          </div>
        </div>
      )}

      {brief.reviewComments.length ? (
        <div className="review-comments">
          <strong>Review feedback</strong>
          {brief.reviewComments.map((comment) => (
            <article key={comment.id}>
              <div className="review-comment-meta">
                <span
                  className="avatar avatar-small"
                  style={{ "--avatar": comment.actor.color } as React.CSSProperties}
                >
                  {comment.actor.name.charAt(0).toUpperCase()}
                </span>
                <span>{comment.actor.name}</span>
                <em>Review {comment.round}</em>
                <time>{formatTime(comment.createdAt)}</time>
              </div>
              <p>{comment.text}</p>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReviewMeta({ brief }: { brief: Brief }) {
  const actor = brief.review.resolvedBy ?? brief.review.startedBy;
  const at = brief.review.resolvedAt ?? brief.review.startedAt;
  if (!actor || !at) return null;
  return (
    <small className="review-meta">
      Review {brief.review.round} · {actor.name} · {formatTime(at)}
    </small>
  );
}

function reviewStatusLabel(status: Brief["review"]["status"]) {
  if (status === "in_review") return "In review";
  if (status === "approved") return "Approved";
  if (status === "changes_requested") return "Changes requested";
  return "Draft";
}

function BriefList({
  title,
  items,
  checks = false,
}: {
  title: string;
  items: string[];
  checks?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div className="brief-list">
      <strong>
        {checks ? <ListChecks size={13} /> : null}
        {title}
      </strong>
      <ul>
        {items.map((item, index) => (
          <li key={`${index}:${item}`}>
            {checks ? <CheckCircle2 size={12} /> : null}
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function lines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}
