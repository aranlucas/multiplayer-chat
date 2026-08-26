import { ArrowUp, Clock3, CornerDownLeft, Paperclip, Zap } from "lucide-react";
import { useState } from "react";
import type { DeliveryMode } from "../../shared/protocol";

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
    if (onSend(value, delivery)) onTextChange("");
  }

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
          rows={2}
          disabled={disabled}
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
          <span>
            <CornerDownLeft size={13} /> Enter to send
          </span>
          <button
            className="send-button"
            type="button"
            onClick={submit}
            disabled={disabled || !text.trim()}
            aria-label="Send"
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
