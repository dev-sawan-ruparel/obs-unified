# Design System Specification: The Technical Monolith

## 1. Overview & Creative North Star
**Creative North Star: "The High-Resolution Ledger"**

This design system rejects the "softness" of modern consumer SaaS in favor of an uncompromising, technical aesthetic. It is inspired by archival documents, terminal interfaces, and high-end horology. We are moving away from the "bubble UI" trend and toward a "Monolithic" layout—one that prizes information density, absolute precision, and sharp-edged authority.

The system breaks the "template" look by utilizing **Extreme Minimalist Structuralism**. We do not use borders to contain ideas; we use the deliberate placement of data and shifting tonal planes to create order. It is an editorial approach to data-dense environments where every pixel must justify its existence.

---

## 2. Colors & Surface Logic

### The Palette
The color economy is strictly enforced. We use a "Clinical White" base punctuated by "Terminal Green" to signify activity and "System Red" for critical failures.

*   **Background:** `#F9F9F9` (The foundational canvas)
*   **Surface:** `#FFFFFF` (The active work plane)
*   **Primary:** `#006B18` (The "Live" state / Action)
*   **Tertiary/Error:** `#B7102A` (The "Critical" state)
*   **On-Surface:** `#1A1C1C` (High-contrast technical text)

### The "No-Line" Rule
**Prohibit 1px solid borders for sectioning.** Conventional UI relies on "boxes within boxes." This system relies on **Tonal Islanding**. Boundaries are defined solely through background shifts. A `surface-container-low` section sitting on a `surface` background provides all the separation required. If you feel the urge to draw a line, increase the padding or shift the background tone instead.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical sheets of high-grade paper stacked atop one another. 
1.  **Level 0 (Base):** `background` (#F9F9F9)
2.  **Level 1 (Panels):** `surface-container-lowest` (#FFFFFF)
3.  **Level 2 (Active Elements):** `surface-container-low` (#F3F3F3)
4.  **Level 3 (Pop-overs):** `surface-container-high` (#E8E8E8)

### Signature Textures: The Digital Vellum
While the UI is flat, main CTAs should utilize a **Micro-Gradient**. Transition from `primary` (#006B18) to `primary-container` (#008821) at a 135-degree angle. This prevents the green from looking "plastic" and gives it a metallic, terminal-phosphor glow.

---

## 3. Typography: Technical Authority

We use **Space Grotesk** exclusively. Its tabular figures and idiosyncratic letterforms suggest a "machine-made" precision that aligns with the local-first transparency of the system.

*   **Display (L/M/S):** Used for data hero-numbers or major section headers. Letter spacing: `-0.02em`.
*   **Headline & Title:** Use for functional area labeling. These should feel "heavy" and immovable.
*   **Body (L/M/S):** The workhorse. `Body-md` (0.875rem) is the default for data density.
*   **Labels:** All-caps with `+0.05em` tracking for a "blueprint" feel.

**Typographic Hierarchy as Branding:**
Balance large `display-sm` data points directly against `label-sm` metadata. The contrast between the massive and the minute creates the "Editorial" feel.

---

## 4. Elevation & Depth: Tonal Layering

### The Layering Principle
Avoid the "Z-axis" obsession of Material Design. We do not use shadows to represent light; we use tonal shifts to represent **logical priority**. 
*   To lift a card, do not add a shadow. Change its background from `surface` to `surface-container-lowest`.

### The "Ghost Border" Fallback
If accessibility requirements (WCAG) demand a container edge in a low-contrast environment, use a **Ghost Border**: `outline-variant` (#BDCBB6) at **15% opacity**. It should be felt, not seen.

### Sharp Corners
**The Radius is Zero.** All components (Buttons, Cards, Inputs, Toasts) must have a `0px` border radius. Sharp corners communicate technical rigor and surgical precision.

---

## 5. Components

### Buttons
*   **Primary:** Sharp `#006B18` block. White text. No icons unless necessary for navigation.
*   **Secondary:** Ghost style. No background, `outline` color for text. On hover: `surface-container-low` background.
*   **States:** Transitions must be instantaneous (50ms or less) to mimic terminal responsiveness.

### Data Chips
*   Used for status tags (e.g., `ENCRYPTED`, `LOCAL`).
*   Square corners. Background: `primary-fixed-dim`. Text: `on-primary-fixed`.
*   Size: Minimal. Padding: `2px 6px`.

### Inputs & Text Areas
*   No "Outlined" boxes. Use a "Bottom-Heavy" approach: A `2px` solid `outline` on the bottom edge only.
*   Focus state: The bottom edge turns `primary` (#006B18).
*   Label: Sits above the input in `label-sm` (Uppercase).

### Data Lists
*   **Forbid Divider Lines.** Use vertical white space (16px or 24px) or subtle alternating row colors using `surface` and `surface-container-low`.
*   **The "Local-First" Indicator:** Every list item should have a 4px vertical "Primary" accent on the far left to indicate data integrity/local sync status.

---

## 6. Do's and Don'ts

### Do:
*   **Embrace the Void:** Use generous white space to separate high-density data clusters.
*   **Tabular Figures:** Ensure all numbers are monospaced/tabular for vertical alignment in ledgers.
*   **Intentional Asymmetry:** Align primary navigation to the left, but keep "System Status" right-aligned and tucked away to create a balanced but non-centered layout.

### Don't:
*   **No Rounded Corners:** Ever. Not even for checkboxes.
*   **No Multi-colored Icons:** Icons must be monochromatic `on-surface` or `primary`. 
*   **No "Soft" Language:** Use technical, transparent terminology. Instead of "Loading," use "INITIALIZING_NODE." Instead of "Error," use "SYSTEM_HALT."

### Accessibility Note:
Despite the "light" theme, ensure the high-contrast `Text #1A1A1A` is always used against the `Surface #FFFFFF` to maintain a contrast ratio of at least 7:1 for all body text. Readability is the ultimate form of transparency.
