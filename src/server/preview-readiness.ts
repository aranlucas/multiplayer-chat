import { ROOM_PROTOCOL_VERSION } from "../shared/protocol";
import { z } from "zod";

const previewReadinessSchema = z.object({
  ready: z.literal(true),
  commitSHA: z.string().optional(),
  roomProtocol: z.literal(ROOM_PROTOCOL_VERSION),
});

export function validatePreviewURL(value: string): string {
  const url = new URL(value);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";

  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("Preview URL must use HTTPS unless it is local");
  }

  url.username = "";
  url.password = "";
  url.hash = "";

  return url.toString();
}

export async function verifyPreview(previewURL: string, commitSHA?: string): Promise<void> {
  const readiness = new URL("/__relay/ready", validatePreviewURL(previewURL));

  const response = await fetch(readiness, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });

  const result = previewReadinessSchema.safeParse(await response.json().catch(() => null));

  if (!response.ok || !result.success) {
    throw new Error("Preview did not pass its Relay readiness check");
  }

  if (commitSHA && result.data.commitSHA !== commitSHA) {
    throw new Error("Preview commit does not match the published revision");
  }
}
