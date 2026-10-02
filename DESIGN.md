---
name: "Relay"
description: "A shared coding room expressed through an ordered broadcast interface."
colors:
  broadcast: "#2033c8"
  signal: "#e6f35a"
  signal-hover: "#f0fc79"
  paper: "#f5f6fa"
  ink: "#13182c"
  panel: "#181f37"
  panel-raised: "#202943"
  panel-soft: "#283351"
  border: "#475570"
  border-soft: "#34415f"
  muted: "#b6c1dc"
  dim: "#a6b5d2"
  room-copy: "#d8dff0"
  landing-support: "#c4cde8"
  broadcast-support: "#e0e4ff"
  paper-divider: "#b8bfda"
  ink-divider: "#53617d"
  delivery-border: "#b8c1ff"
  composer-border: "#59688c"
  lime-soft: "rgba(230, 243, 90, 0.12)"
  amber: "#eba62c"
  amber-soft: "rgba(235, 166, 44, 0.11)"
  red: "#df6252"
  blue: "#78a9ff"
typography:
  display:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "clamp(64px, 8vw, 96px)"
    fontWeight: 700
    lineHeight: 0.92
    letterSpacing: "-0.025em"
  display-mobile:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "clamp(48px, 14vw, 76px)"
    fontWeight: 700
    lineHeight: 0.92
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "clamp(44px, 5vw, 68px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.45
  body-large:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.4
  body-introduction:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "clamp(18px, 1.7vw, 22px)"
    fontWeight: 400
    lineHeight: 1.45
  body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.5
  room-heading:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0"
  room-body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  control:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.45
  control-small:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.45
  room-control:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.45
  label:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.45
  example-label:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: "ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  queue-label:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "8px"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "0.04em"
rounded:
  control: "4px"
  field: "5px"
  room-control: "6px"
  permission: "7px"
  surface: "8px"
  composer: "9px"
  round: "50%"
spacing:
  "4": "4px"
  "6": "6px"
  "8": "8px"
  "10": "10px"
  "12": "12px"
  "14": "14px"
  "16": "16px"
  "18": "18px"
  "20": "20px"
  "22": "22px"
  "24": "24px"
  "28": "28px"
  "30": "30px"
  "32": "32px"
  "36": "36px"
  "40": "40px"
  "48": "48px"
  "56": "56px"
  "64": "64px"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "12px 22px"
  button-primary-hover:
    backgroundColor: "{colors.signal-hover}"
  button-primary-inverse:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "12px 22px"
  button-primary-inverse-hover:
    backgroundColor: "{colors.broadcast}"
  button-delivery:
    backgroundColor: "transparent"
    textColor: "{colors.paper}"
    typography: "{typography.control-small}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
  button-delivery-selected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.broadcast}"
    typography: "{typography.control-small}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
  navigation:
    backgroundColor: "{colors.broadcast}"
    textColor: "{colors.paper}"
    typography: "{typography.control-small}"
    padding: "16px clamp(20px, 5vw, 72px)"
  running-order:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "16px 24px"
  composer:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.paper}"
    rounded: "{rounded.composer}"
  card-permission:
    backgroundColor: "{colors.amber-soft}"
    rounded: "{rounded.permission}"
  card-permission-approved:
    backgroundColor: "{colors.lime-soft}"
  chip-queue:
    backgroundColor: "{colors.amber-soft}"
    textColor: "{colors.amber}"
    typography: "{typography.queue-label}"
    rounded: "{rounded.control}"
    padding: "0 6px"
    height: "18px"
  room-delivery:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.dim}"
    typography: "{typography.room-control}"
    rounded: "{rounded.permission}"
    padding: "3px"
  room-delivery-selected:
    backgroundColor: "{colors.panel-soft}"
    textColor: "{colors.signal}"
    typography: "{typography.room-control}"
    rounded: "{rounded.control}"
    padding: "0 12px"
---

# Design System: Relay

## Overview

**Creative North Star: "The Broadcast Running Order"**

Relay presents shared coding as a clear running order: people, the agent, and the next instruction are easy to distinguish. Broad color fields, compressed headings and flush-left factual text make the shared work visible. The visual identity is direct and graphic; sequence, scope and authority provide the detail.

The landing page uses large rectangular bands and generous reading space. The room carries the same cobalt chrome, signal yellow and navy ground into a denser workspace with ruled rails and compact controls. Keep these two densities appropriate to their purpose. This system records the implemented design after review; it does not establish customer, pricing or performance claims.

**Key Characteristics:**

- Committed cobalt and signal yellow, with cool paper and navy reversals.
- Barlow Condensed headings paired with readable Barlow copy.
- Ordered, flush-left information with visible roles and scope.
- Flat landing bands; tonal room panels and functional overlays.
- Explicit selection, keyboard focus and reduced-motion alternatives.

## Colors

The palette combines saturated broadcast fields with cool neutrals; the frontmatter carries the exact implemented values.

### Primary

- **Broadcast cobalt** (`broadcast`): landing opening, room header, large headings on paper and navigation on light surfaces.
- **Signal yellow** (`signal`, `signal-hover`): current-agent band, prominent actions, room selection and keyboard focus. The lighter hover value belongs to primary buttons.

### Secondary

- **Permission amber** (`amber`, `amber-soft`): pending requests, queue labels and near-limit feedback, paired with visible status text.
- **Tool blue** (`blue`): tool markers and the tool-copy focus ring.
- **Change red** (`red`): removed diff lines and over-limit feedback.

### Neutral

- **Cool paper** (`paper`): light sections, reversed text and selected landing delivery controls.
- **Navy ink** (`ink`): working ground, dark presentation band and text on paper or signal.
- **Room panels** (`panel`, `panel-raised`, `panel-soft`): rails, prompt/tool surfaces and selected controls.
- **Room rules** (`border`, `border-soft`, `composer-border`): panel boundaries, secondary separators and composer outline.
- **Room copy** (`room-copy`, `muted`, `dim`): readable transcript text, secondary explanation and metadata.
- **Presentation support** (`landing-support`, `broadcast-support`): secondary copy on navy or cobalt.
- **Presentation rules** (`paper-divider`, `ink-divider`, `delivery-border`): factual rows on paper/navy and outlined delivery buttons.
- **Signal tint** (`lime-soft`): approved permission surfaces. This existing room utility is distinct from the opaque yellow presentation band.

**The Whole Band Rule.** On presentation surfaces, color changes belong to complete bands or sections. Within the working room, signal yellow identifies selection, actionable controls and status while navy panels hold the detail.

## Typography

**Display Font:** Barlow Condensed with sans-serif fallback, self-hosted Bold (700).
**Body Font:** Barlow with system-ui/sans-serif fallback, self-hosted Regular (400) and SemiBold (600).
**Label/Mono Font:** System monospace for commands, scope and technical metadata.

The compressed display face gives headings and sequence a strong silhouette. Barlow supplies more open reading shapes in the body and interactive UI. Official Google Fonts assets are pinned and licensed under SIL OFL 1.1; see `public/fonts/SOURCE.md` and the two bundled license files. Font synthesis is disabled.

### Hierarchy

- **Display:** the opening uses the `display` role, tight leading and negative tracking. Below the landing compact breakpoint it uses `display-mobile`.
- **Headline:** section headings use `headline`; room rail headings use Barlow Condensed at (19px, 700), and collaboration headings use `room-heading` with their inherited semibold weight. Empty-state headings use the same condensed family at (34px desktop, 30px mobile) with inherited (600) weight.
- **Title:** explanatory and invitation titles use `title`; participants and handoff headings use the smaller Barlow treatment (20px, 600).
- **Body:** landing copy uses `body`, `body-large` or `body-introduction`, with an observed maximum measure (65ch). Running-order instructions use (20px, 1.35) and become (18px) at tablet size and (17px) at compact size. Landing body copy remains (18px) on compact screens.
- **Room body:** transcript prose uses `room-body`, changing to (14px) below the room mobile breakpoint. Composer text is (16px, 1.5).
- **Controls and labels:** primary landing controls use `control`; navigation and delivery controls use `control-small`; room delivery controls use `room-control`. Illustrative captions remain sentence case. Operational room section headings and status labels use uppercase where the existing interface does.
- **Technical text:** permission resources use `code`; landing scope is larger (18px, 15px compact). Timestamps remain compact monospace metadata.

**The Two Voices Rule.** Use Barlow Condensed for major headings, the Relay wordmark and factual sequence numbers. Use Barlow for explanations, participant names and controls; use monospace for commands and technical metadata.

## Layout

The landing page is a scrolling stack of full-width color sections. Its horizontal gutter is fluid (`clamp(20px, 5vw, 72px)`). The desktop opening has a flush-left offer, a definition/action row with a (32px) gap, then ordered bands. Each desktop band has four columns (52px sequence, 160px participant, flexible content, 52px position), a (20px) gap, (16px 24px) padding and a minimum height (100px). Content/heading sections use a two-column ratio (1:1.15), a fluid gap (`clamp(36px, 7vw, 100px)`) and generous section padding. Invitation steps use three equal columns.

At (900px and below), secondary landing navigation links disappear while Open a room remains, the definition row wraps, position labels disappear, the bands use three columns, the delivery controls follow their explanation, and the two-column sections stack. At (560px and below), the primary action fills the available width, each band becomes a two-column numbered sequence with participant above content, invitation steps stack and most content sections use (56px) vertical padding. The compact band minimum height is (120px). The closing action and footer also reflow.

The room uses a fixed-height workspace with independently scrollable transcript and rails. Desktop columns are (264px / minmax(460px, 1fr) / 316px), with a final header height (64px). At (1180px and below), rail widths reduce to (224px / minmax(420px, 1fr) / 276px). Transcript and composer share a maximum width (820px); desktop transcript horizontal padding is (32px).

At (900px and below), the room becomes one column with header, repository/branch context, four tabs and the active work area. The row heights are (60px / 28px / 44px / remaining space); at (430px and below), the header grows to (108px) so the model control occupies a second row. Transcript events keep their ordered markers, reduce the gutter to (45px) and hide timestamps. The composer retains a safe-area-aware bottom inset and delivery/send targets become (44px). The body minimum width is (320px).

Spacing is an observed set of values, not a newly imposed mathematical scale. Compact utility spacing coexists with broad presentation spacing; the frontmatter lists reused steps.

## Elevation & Depth

The landing uses flat bands, color reversal and thin factual rules without shadows. The final room composer also has no shadow at rest or focus. Navy tones and borders separate working surfaces. Existing functional room overlays retain diffuse black shadows, and interactive question surfaces retain a low shadow; these are scoped utilities rather than a landing material treatment.

### Shadow Vocabulary

- **Room popover:** (`0 18px 48px rgba(0, 0, 0, 0.48)`) for repository, title and model popovers.
- **Room transition:** (`0 20px 70px rgba(0, 0, 0, 0.55)`) for the centered room transition overlay.
- **Question card:** (`0 12px 35px rgba(0, 0, 0, 0.16)`) for interactive questions.

**The Flat Band Rule.** Presentation bands and the prompt composer remain flat. Reserve the retained shadow vocabulary for room overlays and interactive question surfaces; it is not decorative elevation for landing content.

The user-triggered running-order splice reveals content with a clip-path change (350ms, `cubic-bezier(0.16, 1, 0.3, 1)`). It carries no spatial bounce or ambient landing motion. Room loading uses its existing spinner and status pulses. Reduced motion suppresses the splice, spinner, room transition pulse and running status pulse, while preserving state text. The sidecar stores their exact values and source snippets.

## Shapes

Landing bands and section boundaries have square corners. Buttons use a small control radius; room inputs and controls use slightly softer corners; prompt/tool surfaces use the shared surface radius. The permission card and composer have their own observed radii. Refer to the frontmatter for these values. Sequence numbers describe order, while circular avatars and event markers distinguish people and event types.

Use thin borders for factual rows, working panels and scope containers. Selected activity rows use an inset signal outline (1px) rather than a decorative side stripe. SVG icons remain functional and sit beside text where the existing component does.

## Components

### Buttons

Direct, rectangular actions with visible text and a functional SVG arrow.

- **Primary:** signal background, navy text, `button-primary` padding and small radius, minimum height (56px). Hover uses `button-primary-hover`.
- **Inverse:** navy background and paper text on the signal closing section. Hover changes to broadcast cobalt.
- **Landing delivery:** outlined, minimum height (48px), with paper text on cobalt. The pressed control becomes paper with cobalt text. Hover adds an underline; `aria-pressed` exposes selection. At compact width both controls share the available row and use (15px) text.
- **Room delivery:** navy bordered group, selected panel-soft fill and signal text, (36px) desktop controls and (44px) mobile controls. The selected class is backed by the delivery state.
- **Focus:** landing links/buttons use (`3px solid currentColor`, offset `4px`). Room controls use (`2px solid signal`, offset `2px`), with contained textarea/tool-copy exceptions. Disabled permission controls use reduced opacity (0.38) and a not-allowed cursor; disabled header/question controls use (0.45).

### Chips

Compact operational tags, not decorative marketing labels.

- **Queue tag:** amber text and translucent amber fill, thin amber border, `chip-queue` dimensions and uppercase tracked type. It supplements the readable queue status.
- **Counts:** existing room count badges are compact rounded metadata alongside section or tab names.

### Cards / Containers

Working containers retain context through a tonal surface and a thin rule.

- **Prompt/tool:** raised prompt and panel tool surfaces use the shared surface radius. Tool summaries and outputs remain monospace and contain their own scroll/wrapping behavior.
- **Permission:** pending cards use amber tint and border; approved cards use signal tint; denied cards use the retained dark neutral treatment. The action and status remain explicit. Resources use a separate dark code container with `overflow-wrap: anywhere` and preserved line breaks.
- **Authority:** pending full cards show Needs maintainer approval. Compact contributors also see that explanation above disabled Approve once and Deny controls. Compact maintainers retain actionable choices. Resolved cards omit the decision controls.
- **Padding:** permission headings/messages use (10px) horizontal inset; scope uses (8px) internal padding; compact cards add (8px) around the interior. Compact transcript permissions follow the event gutter and preserve both choices.

### Inputs / Fields

The prompt composer is a navy raised surface with a thin composer border, its observed radius and no shadow. Its textarea uses (13px 14px 4px) padding, (64px) minimum height, paper text, dim placeholder and signal caret. Focus-within changes the container border to signal; keyboard textarea focus adds a contained ring (offset `-3px`). The character count changes to amber near the limit and red over the limit. Disabled send retains a subdued dark fill and cursor state. Recovery warnings use amber text; empty-state guidance stays readable without animation.

Existing question fields use outlined dark inputs with signal focus and a light focus halo. Keep this functional form treatment scoped to the room rather than applying it to landing bands.

### Navigation

The landing header uses cobalt, the condensed Relay wordmark and Barlow semibold links. Link hover underlines, keyboard focus remains visible, and the compact header preserves Open a room. The room header uses cobalt behind repository/model/thread context and actions. At mobile sizes, four tabs make Transcript, Brief, People and Queue available; active tabs use a signal underline and readable text. The mobile repository/branch row retains working context.

### Running Order

Three contiguous factual bands use paper, signal and navy to distinguish prompt, current agent turn and next instruction. Numbers, participant roles, stage headings and position text reinforce the color. The illustrative caption precedes the bands. Switching delivery moves the sample instruction into the current or next stage, updates the text status, and applies the bounded splice; reduced motion shows the same result immediately. The responsive structure follows Layout.

## Do's and Don'ts

### Do:

- **Do** preserve whole-band color reversals and flush-left hierarchy on presentation surfaces.
- **Do** use the established type roles; keep explanatory copy within the observed 65ch measure where applicable.
- **Do** keep illustrated content explicitly labeled and show participant roles, delivery selection and permission scope in text.
- **Do** retain visible keyboard focus: a current-color ring on landing controls and a signal-yellow ring in the room.
- **Do** retain both permission choices and the visible maintainer explanation when contributor controls are disabled.
- **Do** reflow content at the existing breakpoints and disable the splice, spinner and running pulses for reduced motion.

### Don't:

- **Don't** add decorative shadows, glow or simulated physical textures to the landing bands.
- **Don't** substitute glyph characters or icon fonts for the implemented SVG control icons.
- **Don't** truncate permission resources; allow scope to wrap anywhere on narrow screens.
- **Don't** make color or animation the only way to identify a state or delivery mode.
- **Don't** present illustrative names, messages or decisions as customer evidence, or imply configured services are always available.
