// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { useState } from "react";

function ComposerHarness(
  overrides: Partial<{
    disabled: boolean;
    initialText: string;
    onSend: (text: string, delivery: "steer" | "queue") => boolean;
  }> = {},
) {
  const [text, setText] = useState(overrides.initialText ?? "");
  const onSend = overrides.onSend ?? (() => true);

  return (
    <Composer
      disabled={overrides.disabled ?? false}
      text={text}
      onTextChange={setText}
      onSend={onSend}
    />
  );
}

function renderComposer(
  overrides: Partial<{
    disabled: boolean;
    initialText: string;
    onSend: (text: string, delivery: "steer" | "queue") => boolean;
  }> = {},
) {
  return render(<ComposerHarness {...overrides} />);
}

afterEach(() => {
  cleanup();
});

function getCounter(container: HTMLElement) {
  return container.querySelector("#composer-char-count") as HTMLElement;
}

describe("Composer character counter", () => {
  it("shows character count when typing Hello -> 5 / 8,000", () => {
    const { container } = renderComposer();
    const textarea = screen.getByRole("textbox", { name: /ask or steer/i });
    const counter = getCounter(container);

    expect(counter.textContent).toBe("");

    act(() => {
      fireEvent.change(textarea, { target: { value: "Hello" } });
    });
    expect(counter.textContent).toBe("5 / 8,000");
  });

  it("successful Send -> empty draft and empty counter", () => {
    const onSend = vi.fn(() => true);
    const { container } = renderComposer({ initialText: "Hello world", onSend });
    const textarea = screen.getByRole("textbox", { name: /ask or steer/i }) as HTMLTextAreaElement;
    const counter = getCounter(container);
    expect(counter.textContent).toBe("11 / 8,000");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /send/i }));
    });

    expect(onSend).toHaveBeenCalledWith("Hello world", "steer");
    expect(counter.textContent).toBe("");
    expect(textarea.value).toBe("");
  });

  it("rejected Send -> retained draft and counter", () => {
    const onSend = vi.fn(() => false);
    const { container } = renderComposer({ initialText: "Hello world", onSend });
    const textarea = screen.getByRole("textbox", { name: /ask or steer/i }) as HTMLTextAreaElement;
    const counter = getCounter(container);
    expect(counter.textContent).toBe("11 / 8,000");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /send/i }));
    });

    expect(onSend).toHaveBeenCalledWith("Hello world", "steer");
    expect(counter.textContent).toBe("11 / 8,000");
    expect(textarea.value).toBe("Hello world");
  });

  it("multiline whitespace length counts consistently", () => {
    const { container } = renderComposer({ initialText: "  \n  \t  " });
    const counter = getCounter(container);
    expect(counter.textContent).toBe("8 / 8,000");
  });

  it("aria-live=off and aria-describedby association", () => {
    const { container } = renderComposer();
    const counter = getCounter(container);
    const textarea = screen.getByRole("textbox", { name: /ask or steer/i });

    expect(counter.getAttribute("aria-live")).toBe("off");
    expect(counter.getAttribute("aria-atomic")).toBe("true");
    expect(textarea.getAttribute("aria-describedby")).toBe("composer-char-count");
    expect(counter.getAttribute("id")).toBe("composer-char-count");
  });

  it("Enter key cannot bypass over-limit guard", () => {
    const onSend = vi.fn(() => true);
    const { container } = renderComposer({ initialText: "a".repeat(8001), onSend });
    const textarea = screen.getByRole("textbox", { name: /ask or steer/i });
    const counter = getCounter(container);

    expect(counter.classList.contains("over-limit")).toBe(true);

    act(() => {
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    });

    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("Composer delivery mode", () => {
  it("queued Send with nonempty text uses queue delivery", () => {
    const onSend = vi.fn(() => true);
    function TestWrapper() {
      const [text, setText] = useState("queued message");
      return <Composer text={text} onTextChange={setText} onSend={onSend} />;
    }
    render(<TestWrapper />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /queue next/i }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /send/i }));
    });
    expect(onSend).toHaveBeenCalledWith("queued message", "queue");
  });
});
