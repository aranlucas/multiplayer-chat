import { ZodError } from "zod";
import { describe, expect, it } from "vitest";
import { parseJsonRecord, jsonRecord } from "./json-value";
import { parseClientMessage, parseServerMessage } from "./protocol";
import { parseWorkspaceChanges, MAX_WORKSPACE_FILE_BYTES } from "./workspace-change";
import { textValue } from "./text-value";

describe("validated wire boundaries", () => {
  it("preserves future JSON event fields and optional in-memory object properties", () => {
    const value = {
      type: "future.event",
      data: {
        nested: [{ label: "x", enabled: true, count: 0, absent: undefined }],
        extension: null,
      },
    };

    expect(parseJsonRecord(value)).toEqual(value);
    expect(JSON.parse(JSON.stringify(parseJsonRecord(value)))).toEqual({
      type: "future.event",
      data: { nested: [{ label: "x", enabled: true, count: 0 }], extension: null },
    });
  });
  it.each([
    new Date(),
    new Map(),
    { value: 1n },
    { value: () => 1 },
    { value: [undefined] },
    { value: Number.NaN },
  ])("rejects non-JSON extensions %#", (value) => {
    expect(() => parseJsonRecord(value)).toThrow(ZodError);
  });
  it("does not treat primitive or array extension values as records", () => {
    expect(jsonRecord(["x"])).toEqual({});
    expect(jsonRecord(null)).toEqual({});
    expect(textValue({ toString: "not executable" })).toBe("");
  });
  it("rejects malformed server events before updating room state", () => {
    expect(() =>
      parseServerMessage(
        JSON.stringify({
          type: "event",
          event: { seq: "1", id: "e", kind: "system", createdAt: 1, payload: { text: "hello" } },
        }),
      ),
    ).toThrow(ZodError);
    expect(() =>
      parseServerMessage('{"type":"presence","participants":[{"id":"p","role":"admin"}]}'),
    ).toThrow(ZodError);
  });
  it("preserves prompt normalization and missing or invalid request IDs", () => {
    expect(
      parseClientMessage({ type: "prompt", text: " \0 hi ", delivery: "queue", requestID: 123 }),
    ).toEqual({ type: "prompt", text: "\0 hi", delivery: "queue", requestID: undefined });
    expect(parseClientMessage({ type: "ping", unused: "extension" })).toEqual({ type: "ping" });
  });
  it("enforces answer limits and rejects object coercion", () => {
    const message = { type: "question.reply", sessionID: "s", formID: "f" };
    expect(() =>
      parseClientMessage({ ...message, answer: { q0: Array.from({ length: 21 }, () => "x") } }),
    ).toThrow(ZodError);
    expect(() => parseClientMessage({ ...message, answer: { q0: "x".repeat(2_001) } })).toThrow(
      ZodError,
    );
    expect(() => parseClientMessage({ ...message, answer: { q0: { text: "x" } } })).toThrow(
      ZodError,
    );
    expect(parseClientMessage({ ...message, answer: { q0: [], q1: "" } })).toMatchObject({
      answer: { q0: [], q1: "" },
    });
  });
  it("rejects unsafe checkpoint paths and oversized UTF-8 content", () => {
    expect(() => parseWorkspaceChanges([{ path: "../secret", content: "x" }])).toThrow(ZodError);
    expect(() =>
      parseWorkspaceChanges([
        { path: "file", content: "é".repeat(MAX_WORKSPACE_FILE_BYTES / 2 + 1) },
      ]),
    ).toThrow("Invalid changed file content");
    expect(() => parseWorkspaceChanges([{ path: "file", content: { text: "x" } }])).toThrow(
      ZodError,
    );
    expect(parseWorkspaceChanges([{ path: "file", content: null }])).toEqual([
      { path: "file", content: null },
    ]);
  });
});
