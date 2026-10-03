import { z } from "zod";
import { useCallback, useEffect, useRef, useState } from "react";

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

export function useGitHub(roomID: string, controlOrigin = window.location.origin) {
  const [state, setState] = useState(() => ({
    ...initialState,
    loading: controlOrigin === window.location.origin,
  }));

  const creatingRef = useRef(false);

  useEffect(() => {
    if (controlOrigin !== window.location.origin) {
      return;
    }

    const controller = new AbortController();
    fetch(`${controlOrigin}/api/auth/github/session`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to read the GitHub connection");
        }

        return z
          .object({
            configured: z.boolean(),
            authenticated: z.boolean(),
            user: z.object({ login: z.string(), avatarURL: z.string().optional() }).optional(),
          })
          .parse(await response.json());
      })
      .then((session) => setState((current) => ({ ...current, ...session, loading: false })))
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        setState((current) => ({
          ...current,
          loading: false,
          error: errorMessage(error),
        }));
      });

    return () => controller.abort();
  }, [controlOrigin]);

  const connect = useCallback(() => {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(
      `${controlOrigin}/api/auth/github/start?return=${encodeURIComponent(returnTo)}`,
    );
  }, [controlOrigin]);

  const createPullRequest = useCallback(async () => {
    if (creatingRef.current) {
      return undefined;
    }

    creatingRef.current = true;
    setState((current) => ({ ...current, creating: true, error: undefined }));

    try {
      const response = await fetch(
        `${controlOrigin}/api/rooms/${encodeURIComponent(roomID)}/pull-requests`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );

      const result = z
        .object({
          pullRequest: z.object({ url: z.string() }).optional(),
          error: z.string().optional(),
        })
        .parse(await response.json());

      if (!response.ok || !result.pullRequest) {
        throw new Error(result.error || "Pull request creation failed");
      }

      setState((current) => ({ ...current, creating: false }));
      creatingRef.current = false;

      return result.pullRequest.url;
    } catch (error) {
      setState((current) => ({
        ...current,
        creating: false,
        error: errorMessage(error),
      }));
      creatingRef.current = false;

      return undefined;
    }
  }, [controlOrigin, roomID]);

  return { state, connect, createPullRequest };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "GitHub request failed";
}
