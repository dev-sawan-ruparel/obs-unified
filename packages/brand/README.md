# @obs-unified/brand

Source of truth for obs-unified's visual identity — logo, favicons, OG cards, and CSS design tokens.

The design language is documented in `obs-unified/DESIGN.md` ("The Technical Monolith"). This package is the executable version of that spec: every asset here is built to the same rules — terminal-green primary `#006B18`, clinical-white base, zero radius, Inter Variable, sentence case in chrome with reserved UPPERCASE for section-label tags.

## What's in the box

```
packages/brand/
├── tokens/
│   ├── tokens.css              ← vanilla :root custom properties (light + dark)
│   └── theme.css               ← same palette, declared inside @theme for Tailwind v4
├── logo/
│   ├── mark.svg                ← square monogram (light bg)
│   ├── mark-dark.svg           ← square monogram (dark bg)
│   ├── wordmark.svg            ← mark + "OBS-UNIFIED" lockup (light)
│   └── wordmark-dark.svg       ← mark + "OBS-UNIFIED" lockup (dark)
├── favicons/
│   ├── favicon.svg             ← primary favicon, auto-flips for prefers-color-scheme
│   ├── favicon.ico             ← legacy fallback (generated)
│   ├── apple-touch-icon.svg    ← source for iOS home-screen
│   ├── apple-touch-icon.png    ← 180×180 (generated)
│   ├── icon-maskable.svg       ← PWA maskable source (80% safe zone)
│   ├── icon-192.png            ← PWA standard (generated)
│   ├── icon-512.png            ← PWA standard (generated)
│   ├── icon-maskable-512.png   ← PWA maskable (generated)
│   └── site.webmanifest        ← PWA manifest
├── og/
│   ├── obs-unified.svg         ← product/repo card
│   ├── docs.svg                ← documentation site card
│   ├── presence.svg            ← marketing landing card
│   └── *.jpg                   ← 1200×630 raster fallbacks (generated)
├── scripts/
│   ├── build-rasters.mjs       ← SVG → PNG/JPG/ICO via sharp
│   └── sync-to-projects.mjs    ← copies assets into web/docs/presence public/
└── index.js                    ← programmatic access to asset paths
```

## Using it

### From inside the obs-unified monorepo (web, dashboard, etc.)

Pick the right token file for your stack:

```css
/* Tailwind v4 projects — picks up `@theme` so utility classes like
   bg-sys-bg, text-sys-primary, etc. are generated automatically. */
@import "tailwindcss";
@import "@obs-unified/brand/theme.css";
```

```css
/* Plain CSS (no Tailwind) — gets the same custom properties via :root. */
@import "@obs-unified/brand/tokens.css";
```

Both files declare identical values; keep them in lockstep if you edit one.

Import asset URLs in JSX via Vite/Webpack's URL imports:

```tsx
import faviconUrl from "@obs-unified/brand/favicons/favicon.svg";
import markUrl from "@obs-unified/brand/logo/mark.svg";
```

Or get absolute paths from Node tooling:

```js
import { logo, favicons, og, palette } from "@obs-unified/brand";
console.log(logo.mark); // → absolute path
```

### From obs-unified-docs and presence (sibling repos)

These projects aren't part of the obs-unified pnpm workspace, so they consume assets via a one-shot copy into their `public/` directory:

```bash
node packages/brand/scripts/sync-to-projects.mjs
```

This walks every consuming project, copies in the appropriate subset, and writes a `.brand-source` stamp so it's clear the files are managed.

## Regenerating rasters

The SVG files are the source of truth. PNG/JPG/ICO are generated:

```bash
cd packages/brand
pnpm install         # gets sharp
pnpm build:rasters   # writes favicons/*.png, favicons/favicon.ico, og/*.jpg
pnpm sync            # copies into apps/docs/presence
```

Re-run `build:rasters` any time you edit an SVG. Re-run `sync` after that to push the new files out.

## Editing the design

If you're tempted to add a new color, font, or radius — re-read `DESIGN.md` first. The palette is intentionally constrained: terminal green, system red, clinical white, Inter Variable, zero radius. If you genuinely need a new token, add it to `tokens/tokens.css` and update `DESIGN.md` in the same commit; the tokens file and the spec are not allowed to drift.
