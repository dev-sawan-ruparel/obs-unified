# Design System Specification: The Technical Monolith

## 1. Overview & Creative North Star

**Creative North Star: "The High-Resolution Ledger"**

This design system rejects the "softness" of modern consumer SaaS in favor of an
uncompromising, technical aesthetic. It is inspired by archival documents,
terminal interfaces, and high-end horology. We are moving away from the "bubble
UI" trend and toward a "Monolithic" layout—one that prizes information density,
absolute precision, and sharp-edged authority.

The system breaks the "template" look by utilizing **Extreme Minimalist
Structuralism**. We do not use borders to contain ideas; we use the deliberate
placement of data and shifting tonal planes to create order. It is an editorial
approach to data-dense environments where every pixel must justify its
existence.

### Influences & differentiation

We borrow the **shell grammar** of modern observability tools — persistent left
rail, left-docked filter panel, side-drawer detail — because that grammar is
industry table stakes (Datadog, Honeycomb, Groundcover, Chronosphere all
converge on it). We do **not** borrow their visual identity. Our distinguishing
fingerprints, in priority order:

1. **Sharp zero-radius corners** — never rounded.
2. **Terminal-green primary (`#006B18`)** — never blue/violet.
3. **Light-mode default** — dark mode is opt-in.
4. **Inter Variable + occasional `font-mono` for tabular numerics** — never
   Roboto, never SF Pro.
5. **Sentence-case chrome with reserved uppercase tags** (see §3) — never the
   all-caps shouting common in dev-tools.
6. **Investigation-first nav taxonomy** (Observe / Investigate / Experience /
   Operate) — not data-type-first (Logs / Traces / Metrics).

---

## 2. Colors & Surface Logic

### The Palette

The color economy is strictly enforced. We use a "Clinical White" base
punctuated by "Terminal Green" to signify activity and "System Red" for critical
failures.

- **Background:** `#F9F9F9` (The foundational canvas)
- **Surface:** `#FFFFFF` (The active work plane)
- **Primary:** `#006B18` (The "Live" state / Action)
- **Tertiary/Error:** `#B7102A` (The "Critical" state)
- **On-Surface:** `#1A1C1C` (High-contrast technical text)

### The "No-Line" Rule

**Prohibit 1px solid borders for sectioning.** Conventional UI relies on "boxes
within boxes." This system relies on **Tonal Islanding**. Boundaries are defined
solely through background shifts. A `surface-container-low` section sitting on a
`surface` background provides all the separation required. If you feel the urge
to draw a line, increase the padding or shift the background tone instead.

### Surface Hierarchy & Nesting

Treat the UI as a series of physical sheets of high-grade paper stacked atop one
another.

1.  **Level 0 (Base):** `background` (#F9F9F9)
2.  **Level 1 (Panels):** `surface-container-lowest` (#FFFFFF)
3.  **Level 2 (Active Elements):** `surface-container-low` (#F3F3F3)
4.  **Level 3 (Pop-overs):** `surface-container-high` (#E8E8E8)

### Signature Textures: The Digital Vellum

While the UI is flat, main CTAs should utilize a **Micro-Gradient**. Transition
from `primary` (#006B18) to `primary-container` (#008821) at a 135-degree angle.
This prevents the green from looking "plastic" and gives it a metallic,
terminal-phosphor glow.

---

## 3. Typography: Technical Authority

We use **Inter Variable** as the single sans family across all chrome and
content. Its variable axes give us crisp weights at small sizes (the
data-density we run at) without paying for a font-family swap. The mono fallback
(`ui-monospace`) is reserved for **numerics and code** — never for chrome text.

### Type scale & roles

| Role             | Size    | Weight    | Case      | Tracking | Where                                                           |
| ---------------- | ------- | --------- | --------- | -------- | --------------------------------------------------------------- |
| Brand mark       | 13px    | 700       | UPPERCASE | 0.14em   | Rail header only                                                |
| Group label      | 10px    | 700       | UPPERCASE | 0.12em   | Rail section dividers, "Filters", "Project", small section tags |
| Nav item         | 13px    | 500 / 600 | Sentence  | normal   | Left rail items                                                 |
| Body / chrome    | 13px    | 400 / 500 | Sentence  | normal   | Buttons, inputs, dropdowns, top bar                             |
| Data hero        | 28px    | 300       | —         | -0.02em  | Stat values (mono)                                              |
| Tabular numerics | inherit | inherit   | —         | normal   | Counts, durations, IDs (mono)                                   |

**Sentence case is the default for every interactive surface and label that a
user reads as content** — buttons, inputs, dropdown values, placeholders, status
messages. Reserve UPPERCASE strictly for the 10–13px **section-label tags** in
the table above; that's where the "blueprint" feel earns its keep. Outside that,
uppercase reads as shouting and undermines scan speed.

**Typographic hierarchy as branding:** balance the 28px data hero against the
10px section label. The contrast between the massive and the minute creates the
editorial feel — not screaming chrome.

---

## 4. Elevation & Depth: Tonal Layering

### The Layering Principle

Avoid the "Z-axis" obsession of Material Design. We do not use shadows to
represent light; we use tonal shifts to represent **logical priority**.

- To lift a card, do not add a shadow. Change its background from `surface` to
  `surface-container-lowest`.

### The "Ghost Border" Fallback

If accessibility requirements (WCAG) demand a container edge in a low-contrast
environment, use a **Ghost Border**: `outline-variant` (#BDCBB6) at **15%
opacity**. It should be felt, not seen.

### Sharp Corners

**The Radius is Zero.** All components (Buttons, Cards, Inputs, Toasts) must
have a `0px` border radius. Sharp corners communicate technical rigor and
surgical precision.

---

## 5. Components

### Buttons

- **Primary:** Sharp `#006B18` block. White text. No icons unless necessary for
  navigation.
- **Secondary:** Ghost style. No background, `outline` color for text. On hover:
  `surface-container-low` background.
- **States:** Transitions must be instantaneous (50ms or less) to mimic terminal
  responsiveness.

### Data Chips

- Used for status tags (e.g., `ENCRYPTED`, `LOCAL`).
- Square corners. Background: `primary-fixed-dim`. Text: `on-primary-fixed`.
- Size: Minimal. Padding: `2px 6px`.

### Inputs & Text Areas

- No "Outlined" boxes. Use a "Bottom-Heavy" approach: A `2px` solid `outline` on
  the bottom edge only.
- Focus state: The bottom edge turns `primary` (#006B18).
- Placeholder text: sentence case, `on-surface-subtle`.
- Label: sits above the input in 10px / weight 700 / UPPERCASE / `+0.12em`
  tracking — the section-label tag treatment.

### Data Lists

- **Forbid Divider Lines.** Use vertical white space (16px or 24px) or subtle
  alternating row colors using `surface` and `surface-container-low`.
- **The "Local-First" Indicator:** Every list item should have a 4px vertical
  "Primary" accent on the far left to indicate data integrity/local sync status.

---

## 6. Do's and Don'ts

### Do:

- **Embrace the Void:** Use generous white space to separate high-density data
  clusters.
- **Tabular Figures:** Ensure all numbers are monospaced/tabular for vertical
  alignment in ledgers.
- **Intentional Asymmetry:** Align primary navigation to the left, but keep
  "System Status" right-aligned and tucked away to create a balanced but
  non-centered layout.

### Don't:

- **No Rounded Corners:** Ever. Not even for checkboxes.
- **No Multi-colored Icons:** Icons must be monochromatic `on-surface` or
  `primary`.
- **No SHOUTING:** Don't uppercase buttons, inputs, dropdown values, or chrome
  strings. Uppercase belongs to the 10px section-label tags only. Use technical,
  transparent terminology — "Initializing…" not "INITIALIZING_NODE", "Error" not
  "SYSTEM_HALT". Precision lives in the words; volume is not part of the brand.
- **No mixed font families in chrome.** Inter Variable everywhere except
  numeric/code surfaces (which use `font-mono`). Drift to system mono on chrome
  (e.g. nav chips, button text) is a bug — guard with the typography Playwright
  spec.

### Accessibility Note:

Despite the "light" theme, ensure the high-contrast `Text #1A1A1A` is always
used against the `Surface #FFFFFF` to maintain a contrast ratio of at least 7:1
for all body text. Use `--color-sys-on-surface-muted` (#4E5555, ~8:1) for
secondary text — never `--color-sys-outline` (that's a border token).
Readability is the ultimate form of transparency.

---

## 7. Application Shell

### Left rail (220px expanded / 56px collapsed)

- Brand mark at the top, 13px UPPERCASE.
- Sections grouped by **investigation flow**, not data type:
  - **Observe** — Health, Timeline, Service Map, Logs
  - **Investigate** — Investigations, Traces, Issues, AI Calls
  - **Experience** — Replays
  - **Operate** — Alerts, Usage, Resources
- Pinned to the bottom: Projects, Playground, then the collapse toggle.
- Active state: `surface-low` row fill + 3px `primary` left border. No pill, no
  rounded highlight.
- Collapsed: 9×9 chip with the item's 2-letter shortcode
  (HE/TL/SM/LG/IV/TR/IS/AI/RP/AL/US/RS/PR/PG). Active chip fills with `primary`.
  Hover `title` shows the full label.

### Top bar (48px)

A single horizontal strip with global affordances only:

- Global search input (free-text; subscribed by dashboards via
  `useDashboard().search`).
- Time-range picker — 15m / 1h / 6h / 24h / 7d / 30d (subscribed via
  `useDashboard().timeWindowMins`).
- Project switcher — sentence-case value, group-label "Project" tag.

The top bar must never house tab navigation; tabs live in the rail.

### Filter panel (240px / 32px)

Docked to the left of dashboard content (inside the dashboard, not the shell).
Provides the chrome (`<FilterPanel>` + `<FilterGroup>`); the filter controls
themselves are dashboard-specific. Collapses to a 32px vertical-text strip;
state is persisted per `storageKey`.
