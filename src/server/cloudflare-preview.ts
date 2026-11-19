import { z } from "zod";
import { verifyPreview } from "./preview-readiness";

export interface CloudflarePreviewEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  RELAY_PREVIEW_WORKER_NAME?: string;
  RELAY_PREVIEW_API_TOKEN?: string;
}

const deploymentsSchema = z.object({
  success: z.literal(true),
  result: z.array(
    z.object({
      id: z.string().min(1),
      annotations: z.object({ "workers/commit_sha": z.string().optional() }).nullish(),
      urls: z.array(z.string().nullable()).nullish(),
    }),
  ),
});

export function cloudflarePreviewLookup(env: CloudflarePreviewEnv) {
  const { CLOUDFLARE_ACCOUNT_ID: account, RELAY_PREVIEW_WORKER_NAME: worker } = env;
  const token = env.RELAY_PREVIEW_API_TOKEN;

  if (!account || !worker || !token) {
    return;
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/workers/${encodeURIComponent(worker)}/previews/`;

  return async (branch: string, commitSHA: string) => {
    const response = await fetch(
      `${endpoint}${encodeURIComponent(branch)}/deployments?per_page=100`,
      {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      },
    );

    if (response.status === 404) {
      return;
    }

    if (!response.ok) {
      throw new Error(`Cloudflare Preview lookup failed (HTTP ${response.status})`);
    }

    const { result } = deploymentsSchema.parse(await response.json());

    for (const { id, annotations, urls } of result) {
      const previewURL = urls?.find((url) => url?.startsWith("https://"));

      if (annotations?.["workers/commit_sha"] !== commitSHA || !previewURL) {
        continue;
      }

      // Verify candidates in deployment order. A rebuild of the same SHA may
      // still be starting, while an earlier deployment is already healthy.
      // oxlint-disable-next-line eslint/no-await-in-loop -- Probe one candidate at a time until we find a ready deployment.
      const ready = await verifyPreview(previewURL, commitSHA).then(
        () => true,
        () => false,
      );

      if (ready) {
        return { deploymentID: id, previewURL };
      }
    }
  };
}
