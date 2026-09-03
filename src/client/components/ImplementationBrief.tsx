import { CheckCircle2, Link2, ListChecks, Pencil, Plus, X } from "lucide-react";
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
