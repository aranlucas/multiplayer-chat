import { z } from "zod";
import { actorSchema } from "./protocol";

export const mobileTabSchema = z.enum(["transcript", "brief", "people", "queue"]);

export type MobileTab = z.infer<typeof mobileTabSchema>;

export const handoffParticipantSchema = actorSchema.omit({ color: true });

export type HandoffParticipant = z.infer<typeof handoffParticipantSchema>;

export const handoffClientStateSchema = z.object({
  draft: z
    .string()
    .optional()
    .catch((): undefined => {}),
  selectedID: z
    .string()
    .optional()
    .catch((): undefined => {}),
  mobileTab: mobileTabSchema.optional().catch((): undefined => {}),
});

export type HandoffClientState = z.infer<typeof handoffClientStateSchema>;

export function validateHandoffClientState(
  value: HandoffClientState | undefined,
): HandoffClientState | undefined {
  if (!value) {
    return undefined;
  }

  const state = handoffClientStateSchema.parse(value);

  return {
    draft: state.draft?.slice(0, 8_000),
    selectedID: state.selectedID?.slice(0, 200),
    mobileTab: state.mobileTab ?? "transcript",
  };
}
