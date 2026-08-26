export interface GitHubOAuthEnv {
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  GITHUB_SESSION_SECRET?: string;
}

export interface GitHubSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshTokenExpiresAt?: number;
  login: string;
  avatarURL?: string;
}

export interface GitHubSessionResult {
  session?: GitHubSession;
  setCookie?: string;
}

const SESSION_COOKIE = "relay_github_session";
const STATE_COOKIE = "relay_github_state";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function beginGitHubAuthorization(request: Request, env: GitHubOAuthEnv): Promise<Response> {
  assertConfigured(env);
  const requestURL = new URL(request.url);
  const returnTo = safeReturnTo(requestURL.searchParams.get("return"));
  const state = crypto.randomUUID();
  const sealedState = await seal({ state, returnTo }, env.GITHUB_SESSION_SECRET!);
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_OAUTH_CLIENT_ID!);
  authorize.searchParams.set("redirect_uri", `${requestURL.origin}/api/auth/github/callback`);
  authorize.searchParams.set("scope", "public_repo");
  authorize.searchParams.set("state", state);
  return redirect(authorize, cookie(STATE_COOKIE, sealedState, { maxAge: 600, path: "/api/auth/github/callback" }));
}

export async function completeGitHubAuthorization(request: Request, env: GitHubOAuthEnv): Promise<Response> {
  assertConfigured(env);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const sealedState = parseCookies(request.headers.get("Cookie"))[STATE_COOKIE];
  if (!code || !state || !sealedState) throw new Error("GitHub authorization state is missing");
  const expected = await unseal<{ state: string; returnTo: string }>(sealedState, env.GITHUB_SESSION_SECRET!);
  if (!timingSafeEqual(state, expected.state)) throw new Error("GitHub authorization state did not match");

  const token = await exchangeToken({
    clientID: env.GITHUB_OAUTH_CLIENT_ID!,
    clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET!,
    code,
    redirectURI: `${url.origin}/api/auth/github/callback`,
  });
  const profile = await githubProfile(token.access_token);
  const now = Date.now();
  const session: GitHubSession = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_in ? now + token.expires_in * 1_000 : undefined,
    refreshTokenExpiresAt: token.refresh_token_expires_in ? now + token.refresh_token_expires_in * 1_000 : undefined,
    login: profile.login,
    avatarURL: profile.avatar_url,
  };
  const headers = new Headers({ Location: new URL(expected.returnTo, url.origin).toString() });
  headers.append("Set-Cookie", await sessionCookie(session, env.GITHUB_SESSION_SECRET!));
  headers.append("Set-Cookie", cookie(STATE_COOKIE, "", { maxAge: 0, path: "/api/auth/github/callback" }));
  return new Response(null, { status: 302, headers });
}

export async function readGitHubSession(request: Request, env: GitHubOAuthEnv): Promise<GitHubSessionResult> {
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET || !env.GITHUB_SESSION_SECRET) return {};
  const value = parseCookies(request.headers.get("Cookie"))[SESSION_COOKIE];
  if (!value) return {};
  try {
    let session = await unseal<GitHubSession>(value, env.GITHUB_SESSION_SECRET);
    if (session.expiresAt && session.expiresAt <= Date.now() + 60_000) {
      if (!session.refreshToken || (session.refreshTokenExpiresAt && session.refreshTokenExpiresAt <= Date.now())) return {};
      const token = await refreshToken({
        clientID: env.GITHUB_OAUTH_CLIENT_ID,
        clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
        refreshToken: session.refreshToken,
      });
      const now = Date.now();
      session = {
        ...session,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? session.refreshToken,
        expiresAt: token.expires_in ? now + token.expires_in * 1_000 : undefined,
        refreshTokenExpiresAt: token.refresh_token_expires_in
          ? now + token.refresh_token_expires_in * 1_000
          : session.refreshTokenExpiresAt,
      };
      return { session, setCookie: await sessionCookie(session, env.GITHUB_SESSION_SECRET) };
    }
    return { session };
  } catch {
    return {};
  }
}

export function clearGitHubSessionCookie(): string {
  return cookie(SESSION_COOKIE, "", { maxAge: 0 });
}

export function githubOAuthConfigured(env: GitHubOAuthEnv): boolean {
  return Boolean(env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET && env.GITHUB_SESSION_SECRET);
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

async function exchangeToken(input: { clientID: string; clientSecret: string; code: string; redirectURI: string }) {
  return tokenRequest({
    client_id: input.clientID,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectURI,
  });
}

async function refreshToken(input: { clientID: string; clientSecret: string; refreshToken: string }) {
  return tokenRequest({
    client_id: input.clientID,
    client_secret: input.clientSecret,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json<TokenResponse>();
  if (!response.ok || value.error || !value.access_token) {
    throw new Error(value.error_description || value.error || `GitHub token exchange failed (${response.status})`);
  }
  return value;
}

async function githubProfile(accessToken: string): Promise<{ login: string; avatar_url?: string }> {
  const response = await fetch("https://api.github.com/user", {
    headers: githubHeaders(accessToken),
  });
  const value = await response.json<{ login?: string; avatar_url?: string; message?: string }>();
  if (!response.ok || !value.login) throw new Error(value.message || "GitHub identity lookup failed");
  return { login: value.login, avatar_url: value.avatar_url };
}

function githubHeaders(accessToken: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "relay-multiplayer-agent",
    "X-GitHub-Api-Version": "2026-03-10",
  };
}

function assertConfigured(env: GitHubOAuthEnv): asserts env is Required<GitHubOAuthEnv> {
  if (!githubOAuthConfigured(env)) throw new Error("GitHub OAuth is not configured");
}

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value.slice(0, 1_000);
}

async function sessionCookie(session: GitHubSession, secret: string): Promise<string> {
  const maxAge = session.refreshTokenExpiresAt
    ? Math.max(0, Math.floor((session.refreshTokenExpiresAt - Date.now()) / 1_000))
    : 60 * 60 * 24 * 30;
  return cookie(SESSION_COOKIE, await seal(session, secret), { maxAge });
}

async function seal(value: unknown, secret: string): Promise<string> {
  const key = await encryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(value))));
  const joined = new Uint8Array(iv.length + ciphertext.length);
  joined.set(iv);
  joined.set(ciphertext, iv.length);
  return base64URL(joined);
}

async function unseal<T>(value: string, secret: string): Promise<T> {
  const bytes = fromBase64URL(value);
  if (bytes.length < 29) throw new Error("Invalid encrypted session");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) },
    await encryptionKey(secret),
    bytes.slice(12),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64URL(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64URL(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(header.split(";").flatMap((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [] : [[part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))]];
  }));
}

function cookie(name: string, value: string, options: { maxAge: number; path?: string }): string {
  return `${name}=${encodeURIComponent(value)}; Path=${options.path ?? "/"}; Max-Age=${options.maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function redirect(location: URL, setCookie: string): Response {
  return new Response(null, { status: 302, headers: { Location: location.toString(), "Set-Cookie": setCookie } });
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}
