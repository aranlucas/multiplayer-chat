# Relay design principles

Relay expresses shared coding as a **broadcast running order**: people, the
current agent turn and the next instruction should be easy to distinguish.
The landing page introduces that sequence with broad color bands; the room
uses a denser workspace so participants can follow the work and its authority.

## Visual language

- Use whole-band color reversals and flush-left hierarchy on presentation
  surfaces. Cobalt provides the broadcast frame, signal yellow emphasizes
  actions and selection, and navy panels hold working detail.
- Keep landing bands and the composer flat. Reserve shadows for functional
  room overlays and interactive questions.
- Use Barlow Condensed for major headings, the wordmark and sequence numbers;
  Barlow for explanations, participant names and controls; monospace for
  commands and permission scope. Font provenance and licenses are in
  [public/fonts/SOURCE.md](public/fonts/SOURCE.md).

[styles.css](src/client/styles.css) owns exact colors, typography, dimensions,
breakpoints and animation values. Reuse those definitions rather than maintaining
a second token catalog here.

## Interaction requirements

- Show participant roles, delivery selection and permission scope in text.
  Color and animation must not be the only way to identify a state.
- Keep both **Approve once** and **Deny** visible for pending permissions.
  Explain the maintainer requirement when contributor controls are disabled;
  allow long resource paths to wrap rather than truncate them.
- Preserve visible keyboard focus and reduced-motion alternatives. Suppressing
  the running-order transition or loading pulses must preserve the state text.
- Keep the transcript, brief, people and queue accessible on small screens,
  along with repository context and usable composer controls.
- Label landing demonstrations illustrative. Synthetic names, prompts and
  decisions are not customer evidence; configured services are not proof of
  availability.

See [PRODUCT.md](PRODUCT.md) for the product principles and
[the README captures](README.md#bring-the-whole-room-into-the-coding-loop) for
local desktop and mobile examples.
