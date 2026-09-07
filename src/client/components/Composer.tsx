import { ArrowUp, Clock3, CornerDownLeft, Paperclip, Zap } from "lucide-react";
import { useState } from "react";
import type { DeliveryMode } from "../../shared/protocol";

const MAX_LENGTH = 8000;

interface ComposerProps {
  disabled?: boolean;
  text: string;
  onTextChange: (text: string) => void;
  onSend: (text: string, delivery: DeliveryMode) => boolean;
}

export function Composer({
  disabled,
  text,
  onTextChange,
  onSend,
}: ComposerProps) {
  const [delivery, setDelivery] = useState<DeliveryMode>("steer");

  function submit() {
    const value = text.trim();
    if (!value || disabled) return;
    if (text.length > MAX_LENGTH) return;
    if (onSend(value, delivery)) onTextChange("");
  }

  const remaining = MAX_LENGTH - text.length;
  const isNearLimit = remaining < 100;
  const isOverLimit = remaining < 0;

  return (
    <div className="composer-wrap">
      <div
        className="delivery-switch"
        role="group"
        aria-label="Message delivery"
      >
        <button
          className={delivery === "steer" ? "is-active" : ""}
          type="button"
          onClick={() => setDelivery("steer")}
        >
          <Zap size={15} /> Steer now
        </button>
        <button
          className={delivery === "queue" ? "is-active" : ""}
          type="button"
          onClick={() => setDelivery("queue")}
        >
          <Clock3 size={15} /> Queue next
        </button>
      </div>
      <div className="composer">
        <textarea
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Ask or steer the agent…"
          aria-label="Ask or steer the agent"
          aria-describedby="composer-char-count"
          rows={2}
          disabled={disabled}
          maxLength={MAX_LENGTH}
        />
        <div className="composer-tools">
          <button
            type="button"
            aria-label="Attach file"
            disabled
            title="Attachments are coming next"
          >
            <Paperclip size={17} />
          </button>
          <span id="composer-char-count" className={`char-count ${isNearLimit ? "near-limit" : ""} ${isOverLimit ? "over-limit" : ""}`} aria-live="off" aria-atomic="true">
            {text.length > 0 ? `${text.length.toLocaleString()} / ${MAX_LENGTH.toLocaleString()}` : ""}
          </span>
          <span>
            <CornerDownLeft size={13} /> Enter to send
          </span>
          <button
            className="send-button"
            type="button"
            onClick={submit}
            disabled={disabled || !text.trim() || isOverLimit}
            aria-label="Send"
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
