import type { CSSProperties } from "react";

interface AvatarStyle extends CSSProperties {
  "--avatar": string;
}

export function avatarStyle(color: string): AvatarStyle {
  return { "--avatar": color };
}
