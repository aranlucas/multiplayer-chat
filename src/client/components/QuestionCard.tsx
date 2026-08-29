import { Check, CircleHelp, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import type { DisplayEvent, QuestionField } from "../event-display";

type QuestionDisplay = Extract<DisplayEvent, { type: "question" }>;

interface QuestionCardProps {
  question: QuestionDisplay;
  onReply: (
    sessionID: string,
    formID: string,
    answer: Record<string, string | string[]>,
  ) => boolean;
  onCancel: (sessionID: string, formID: string) => boolean;
}

export function QuestionCard({
  question,
  onReply,
  onCancel,
}: QuestionCardProps) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<"reply" | "cancel">();

  const answer = buildAnswer(question.fields, selected, custom);
  const complete = question.fields.every(
    (field) => answerValues(answer[field.key]).length > 0,
  );

  if (question.status !== "pending") {
    return (
      <div className={`question-card question-${question.status}`}>
        <QuestionHeading question={question} />
        {question.status === "answered" ? (
          <div className="question-results">
            {question.fields.map((field) => (
              <div key={field.key}>
                <span>{field.title}</span>
                <strong>
                  {answerValues(question.answer?.[field.key]).join(", ") ||
                    "Unanswered"}
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="question-dismissed-copy">
            The question was dismissed without an answer.
          </p>
        )}
      </div>
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!complete || submitting) return;
    if (onReply(question.sessionID, question.formID, answer))
      setSubmitting("reply");
  }

  function cancel() {
    if (submitting) return;
    if (onCancel(question.sessionID, question.formID)) setSubmitting("cancel");
  }

  return (
    <form className="question-card" onSubmit={submit}>
      <QuestionHeading question={question} />
      <div className="question-fields">
        {question.fields.map((field) => (
          <fieldset className="question-field" key={field.key}>
            <legend>{field.title}</legend>
            <p>{field.description}</p>
            <div className="question-options">
              {field.options.map((option) => {
                const checked = selected[field.key]?.includes(option.value);
                return (
                  <label
                    className={`question-option ${checked ? "is-selected" : ""}`}
                    key={option.value}
                  >
                    <input
                      type={field.type === "multiselect" ? "checkbox" : "radio"}
                      name={field.key}
                      value={option.value}
                      checked={checked ?? false}
                      onChange={() => {
                        setSelected((current) =>
                          selectOption(current, field, option.value),
                        );
                        if (field.type === "string")
                          setCustom((current) => ({
                            ...current,
                            [field.key]: "",
                          }));
                      }}
                    />
                    <span
                      className="question-option-control"
                      aria-hidden="true"
                    >
                      {checked ? <Check size={13} /> : null}
                    </span>
                    <span>
                      <strong>{option.label}</strong>
                      {option.description ? (
                        <em>{option.description}</em>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
            {field.custom ? (
              <label className="question-custom">
                <span>Type your own answer</span>
                <input
                  type="text"
                  value={custom[field.key] ?? ""}
                  placeholder="Add another answer…"
                  onChange={(event) => {
                    const value = event.target.value;
                    setCustom((current) => ({
                      ...current,
                      [field.key]: value,
                    }));
                    if (field.type === "string" && value)
                      setSelected((current) => ({
                        ...current,
                        [field.key]: [],
                      }));
                  }}
                />
              </label>
            ) : null}
          </fieldset>
        ))}
      </div>
      <div className="question-actions">
        <button
          className="question-dismiss"
          type="button"
          onClick={cancel}
          disabled={Boolean(submitting)}
        >
          {submitting === "cancel" ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <X size={14} />
          )}
          Dismiss
        </button>
        <button
          className="question-submit"
          type="submit"
          disabled={!complete || Boolean(submitting)}
        >
          {submitting === "reply" ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <Check size={14} />
          )}
          {submitting === "reply" ? "Sending…" : "Submit answer"}
        </button>
      </div>
    </form>
  );
}

function QuestionHeading({ question }: { question: QuestionDisplay }) {
  return (
    <div className="question-heading">
      <span className="question-icon">
        <CircleHelp size={17} />
      </span>
      <div>
        <strong>{question.title}</strong>
        <span>
          {question.status === "pending"
            ? "Your response will let the agent continue"
            : question.status}
        </span>
      </div>
    </div>
  );
}

function selectOption(
  current: Record<string, string[]>,
  field: QuestionField,
  value: string,
) {
  if (field.type === "string") return { ...current, [field.key]: [value] };
  const existing = current[field.key] ?? [];
  return {
    ...current,
    [field.key]: existing.includes(value)
      ? existing.filter((item) => item !== value)
      : [...existing, value],
  };
}

function buildAnswer(
  fields: QuestionField[],
  selected: Record<string, string[]>,
  custom: Record<string, string>,
) {
  return Object.fromEntries(
    fields.map((field) => {
      const ownAnswer = custom[field.key]?.trim();
      if (field.type === "string")
        return [field.key, ownAnswer || selected[field.key]?.[0] || ""];
      return [
        field.key,
        [...(selected[field.key] ?? []), ...(ownAnswer ? [ownAnswer] : [])],
      ];
    }),
  ) as Record<string, string | string[]>;
}

function answerValues(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}
