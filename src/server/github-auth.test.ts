import { ZodError } from "zod";
import { describe, expect, it } from "vitest";
import { sealGitHubCredential, unsealGitHubCredential } from "./github-auth";

const env = { GITHUB_SESSION_SECRET: "synthetic-local-encryption-key" };

describe("encrypted credential boundary", () => {
  it("round trips a synthetic credential and rejects a different key or tampering", async () => {
    const credential = { accessToken: "synthetic-token", login: "synthetic-user" };
    const sealed = await sealGitHubCredential(credential, env);
    expect(await unsealGitHubCredential(sealed, env)).toEqual(credential);
    await expect(
      unsealGitHubCredential(sealed, { GITHUB_SESSION_SECRET: "other-synthetic-key" }),
    ).rejects.toThrow(DOMException);
    const tampered = `${sealed[0] === "A" ? "B" : "A"}${sealed.slice(1)}`;
    await expect(unsealGitHubCredential(tampered, env)).rejects.toThrow(DOMException);
  });
  it("rejects authenticated ciphertext with an invalid credential shape", async () => {
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(env.GITHUB_SESSION_SECRET));
    const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoder.encode(JSON.stringify({ accessToken: 42, login: "synthetic-user" })),
      ),
    );

    const bytes = new Uint8Array(iv.length + encrypted.length);
    bytes.set(iv);
    bytes.set(encrypted, iv.length);

    const sealed = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");

    await expect(unsealGitHubCredential(sealed, env)).rejects.toThrow(ZodError);
  });
});
