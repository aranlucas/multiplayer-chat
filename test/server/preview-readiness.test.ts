import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyPreview, validatePreviewURL } from "@/server/preview-readiness";

afterEach(() => vi.unstubAllGlobals());

describe("preview readiness boundary", () => {
  it.each([
    { ready: "yes", roomProtocol: 1, commitSHA: "abc" },
    { ready: false, roomProtocol: 1, commitSHA: "abc" },
    { ready: true, roomProtocol: "1", commitSHA: "abc" },
    { ready: true, roomProtocol: 2, commitSHA: "abc" },
    { ready: true, roomProtocol: 1, commitSHA: "other" },
    { ready: true, roomProtocol: 1 },
    null,
  ])("rejects readiness that cannot establish the published contract: %j", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    await expect(verifyPreview("https://preview.example", "abc")).rejects.toThrow(
      /readiness check|commit does not match/,
    );
  });

  it("checks the published SHA at the origin readiness endpoint", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        Response.json({ ready: true, roomProtocol: 1, commitSHA: "abc", futureField: true }),
      );

    vi.stubGlobal("fetch", fetchImpl);
    await expect(
      verifyPreview("https://user:pass@preview.example/path#secret", "abc"),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://preview.example/__relay/ready"),
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("allows local previews without a published Git commit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ ready: true, roomProtocol: 1 })),
    );
    await expect(verifyPreview("http://localhost:5174")).resolves.toBeUndefined();
  });

  it.each([
    new Response("unavailable", { status: 503 }),
    Response.json({ ready: true, roomProtocol: 1, commitSHA: "abc" }, { status: 503 }),
    new Response("not JSON"),
  ])("rejects unsuccessful or undecodable readiness responses %#", async (response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(verifyPreview("https://preview.example", "abc")).rejects.toThrow(
      /readiness check|commit does not match/,
    );
  });

  it("propagates network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(verifyPreview("https://preview.example", "abc")).rejects.toThrow("offline");
  });

  it("rejects remote plaintext previews before making a request", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    await expect(verifyPreview("http://preview.example", "abc")).rejects.toThrow("HTTPS");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(validatePreviewURL("http://127.0.0.1:5174/path")).toBe("http://127.0.0.1:5174/path");
  });
});
