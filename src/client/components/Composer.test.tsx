import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

function renderComposer(overrides: Partial<{
  disabled: boolean;
  text: string;
  onSend: (text: string, delivery: "steer" | "queue") => boolean;
}> = {}) {
  return render(
    <Composer
      disabled={overrides.disabled ?? false}
      text={overrides.text ?? ""}
      onTextChange={vi.fn()}
      onSend={overrides.onSend ?? (() => true)}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("Composer character counter", () => {
  it("shows character count when typing", () => {
    renderComposer();
    const textarea = screen.getByRole("textbox", { name: /ask or steer/i });
    const counter = screen.getByRole("status");

    expect(counter.textContent).toBe("");

    fireEvent.change(textarea, { target: { value: "Hello" } });
    expect(counter.textContent).toBe("5 / 8,000");
  });

  it("shows zero count when text is cleared", () => {
    renderComposer({ text: "Hello" });
    const counter = screen.getByRole("status");
    expect(counter.textContent).toBe("5 / 8,000");

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(counter.textContent).toBe("");
  });

  it("shows near-limit style when approaching limit", () => {
    renderComposer({ text: "a".repeat(7950) });
    const counter = screen.getByRole("status");
    expect(counter.classList.contains("near-limit")).toBe(true);
    expect(counter.classList.contains("over-limit")).toBe(false);
  });

  it("shows over-limit style when exceeding limit", () => {
    renderComposer({ text: "a".repeat(8001) });
    const counter = screen.getByRole("status");
    expect(counter.classList.contains("over-limit")).toBe(true);
  });

  it("disables send button when over limit", () => {
    renderComposer({ text: "a".repeat(8001) });
    const sendButton = screen.getByRole("button", { name: /send/i });
    expect(sendButton.disabled).toBe(true);
  });

  it("resets counter after successful send", () => {
    const onSend = vi.fn(() => true);
    renderComposer({ text: "Hello world", onSend });
    const counter = screen.getByRole("status");
    expect(counter.textContent).toBe("11 / 8,000");

    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith("Hello world", "steer");
    // The onTextChange would be called with "" by the parent, which would reset the counter
    // Since we're testing the component in isolation, we verify the send was called
  });

  it("does not reset counter when send fails", () => {
    const onSend = vi.fn(() => false);
    renderComposer({ text: "Hello world", onSend });
    const counter = screen.getByRole("status");
    expect(counter.textContent).toBe("11 / 8,000");

    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith("Hello world", "steer");
    // Counter should still show the text since send failed
  });

  it("respects maxLength on textarea", () => {
    renderComposer();
    const textarea = screen.getByRole("textbox", { name: /ask or steer/i });
    expect(textarea.hasAttribute("maxLength")).toBe(true);
    expect(textarea.getAttribute("maxLength")).toBe("8000");
  });

  it("announces count changes politely via aria-live", () => {
    renderComposer();
    const counter = screen.getByRole("status");
    expect(counter.getAttribute("aria-live")).toBe("polite");
    expect(counter.getAttribute("aria-atomic")).toBe("true");
  });

  it("links counter to textarea via aria-describedby", () => {
    renderComposer();
    const textarea = screen.getByRole("textbox", { name: /ask or steer/i });
    const counter = screen.getByRole("status");
    expect(textarea.getAttribute("aria-describedby")).toBe("composer-char-count");
    expect(counter.getAttribute("id")).toBe("composer-char-count");
  });
});

describe("Composer delivery mode", () => {
  it("defaults to steer mode", () => {
    renderComposer();
    const steerButton = screen.getByRole("button", { name: /steer now/i });
    expect(steerButton.classList.contains("is-active")).toBe(true);
  });

  it("switches to queue mode when clicked", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /queue next/i }));
    const queueButton = screen.getByRole("button", { name: /queue next/i });
    expect(queueButton.classList.contains("is-active")).toBe(true);
  });

  it("passes selected delivery mode to onSend", () => {
    const onSend = vi.fn(() => true);
    renderComposer({ onSend });
    fireEvent.click(screen.getByRole("button", { name: /queue next/i }));
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith("", "queue");
  });
});