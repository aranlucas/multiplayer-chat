import { ZodError } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  beginGitHubAuthorization,
  completeGitHubAuthorization,
  readGitHubSession,
  sealGitHubCredential,
  unsealGitHubCredential,
} from "@/server/github-auth";

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

    const sealed = btoa(Array.from(bytes, (byte) => String.fromCodePoint(byte)).join(""))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");

    await expect(unsealGitHubCredential(sealed, env)).rejects.toThrow(ZodError);
  });
});

const oauthEnv = {
  ...env,
  GITHUB_OAUTH_CLIENT_ID: "synthetic-client",
  GITHUB_OAUTH_CLIENT_SECRET: "synthetic-secret",
};

it("ignores malformed unrelated cookies while reading valid and absent sessions", async () => {
  const credential = { accessToken: "synthetic-token", login: "synthetic-user" };
  const session = await sealGitHubCredential(credential, oauthEnv);

  const result = await readGitHubSession(
    new Request("https://relay.example/api/auth/github/session", {
      headers: { Cookie: `other=%; relay_github_session=${session}` },
    }),
    oauthEnv,
  );

  expect(result.session).toEqual(credential);
  expect(
    await readGitHubSession(
      new Request("https://relay.example/api/auth/github/session", {
        headers: { Cookie: "other=%" },
      }),
      oauthEnv,
    ),
  ).toEqual({});
});

it.each([
  String.raw`/\evil.example`,
  "//evil.example",
  "/\t/evil.example",
  "/\n/evil.example",
  "/%2f%2fevil.example",
])("keeps the OAuth callback on the application origin for return %s", async (returnTo) => {
  const start = await beginGitHubAuthorization(
    new Request(
      `https://relay.example/api/auth/github/start?return=${encodeURIComponent(returnTo)}`,
    ),
    oauthEnv,
  );

  const location = new URL(start.headers.get("Location") ?? "");
  const stateCookie = start.headers.get("Set-Cookie")?.split(";")[0];
  expect(stateCookie).toBeTruthy();
  const fetcher = vi.spyOn(globalThis, "fetch");
  fetcher.mockResolvedValueOnce(Response.json({ access_token: "synthetic-token" }));
  fetcher.mockResolvedValueOnce(Response.json({ login: "synthetic-user" }));

  try {
    const callback = await completeGitHubAuthorization(
      new Request(
        `https://relay.example/api/auth/github/callback?code=code&state=${location.searchParams.get("state") ?? ""}`,
        {
          headers: { Cookie: stateCookie ?? "" },
        },
      ),
      oauthEnv,
    );

    expect(new URL(callback.headers.get("Location") ?? "").origin).toBe("https://relay.example");
  } finally {
    fetcher.mockRestore();
  }
});

it("preserves a valid room return path after OAuth", async () => {
  const start = await beginGitHubAuthorization(
    new Request(
      "https://relay.example/api/auth/github/start?return=%2Fr%2Froom%3Fname%3DAlice%23selection",
    ),
    oauthEnv,
  );

  const state = new URL(start.headers.get("Location") ?? "").searchParams.get("state") ?? "";
  const cookie = start.headers.get("Set-Cookie")?.split(";")[0] ?? "";
  const fetcher = vi.spyOn(globalThis, "fetch");
  fetcher.mockResolvedValueOnce(Response.json({ access_token: "synthetic-token" }));
  fetcher.mockResolvedValueOnce(Response.json({ login: "synthetic-user" }));

  try {
    const callback = await completeGitHubAuthorization(
      new Request(`https://relay.example/api/auth/github/callback?code=code&state=${state}`, {
        headers: { Cookie: cookie },
      }),
      oauthEnv,
    );

    expect(callback.headers.get("Location")).toBe(
      "https://relay.example/r/room?name=Alice#selection",
    );
  } finally {
    fetcher.mockRestore();
  }
});
