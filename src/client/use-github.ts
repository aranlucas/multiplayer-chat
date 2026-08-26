import { useCallback, useEffect, useState } from "react";

interface GitHubUser {
  login: string;
  avatarURL?: string;
}

interface GitHubState {
  configured: boolean;
  authenticated: boolean;
  loading: boolean;
  creating: boolean;
  user?: GitHubUser;
  error?: string;
}

const initialState: GitHubState = {
  configured: false,
  authenticated: false,
  loading: true,
  creating: false,
};

export function useGitHub(roomID: string) {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/github/session", { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to read the GitHub connection");
        return response.json() as Promise<{ configured: boolean; authenticated: boolean; user?: GitHubUser }>;
      })
      .then((session) => setState((current) => ({ ...current, ...session, loading: false })))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState((current) => ({ ...current, loading: false, error: errorMessage(error) }));
      });
    return () => controller.abort();
  }, []);

  const connect = useCallback(() => {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/api/auth/github/start?return=${encodeURIComponent(returnTo)}`);
  }, []);

  const createPullRequest = useCallback(async () => {
    setState((current) => ({ ...current, creating: true, error: undefined }));
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomID)}/pull-requests`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const result = await response.json() as { pullRequest?: { url: string }; error?: string };
      if (!response.ok || !result.pullRequest) throw new Error(result.error || "Pull request creation failed");
      setState((current) => ({ ...current, creating: false }));
      return result.pullRequest.url;
    } catch (error) {
      setState((current) => ({ ...current, creating: false, error: errorMessage(error) }));
      return undefined;
    }
  }, [roomID]);

  return { state, connect, createPullRequest };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "GitHub request failed";
}
