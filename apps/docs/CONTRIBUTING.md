# Contributing to obs-unified-docs

Thanks for considering a contribution. The canonical contribution guide for the entire obs-unified org lives in [`obs-unified/CONTRIBUTING.md`](https://github.com/obs-unified/obs-unified/blob/main/CONTRIBUTING.md) — commit message style, RFC tree, review process, etc.

A few `obs-unified-docs`-specific notes on top of that:

## Local setup

```bash
pnpm install      # postinstall runs fumadocs-mdx
pnpm dev          # http://localhost:3000
```

Requires Node 22+ and pnpm 10+.

## Editing content

Pages live in [`content/docs/`](./content/docs/) as MDX. Each page has frontmatter (`title`, `description`) and is registered in [`meta.json`](./content/docs/meta.json) — that controls the sidebar order.

When you add or rename a page:

1. Create `content/docs/<slug>.mdx` with frontmatter
2. Add the slug to `content/docs/meta.json`
3. `pnpm dev` should pick it up live — no restart needed
4. Cross-link from related pages

## Before opening a PR

```bash
pnpm types:check  # react-router typegen + fumadocs-mdx + tsc --noEmit
pnpm build        # full production build to build/client/
```

Both should pass clean. CI runs the same two commands on the self-hosted runner from [`obs-unified/ci`](https://github.com/obs-unified/ci).

## Accuracy over completeness

This is a docs site for a real product. Anything described here should match what the code does. If you're not sure, check the [`obs-unified`](https://github.com/obs-unified/obs-unified) repo (or ask) — don't ship aspirational documentation.

## What lives here

This repo is **only the documentation site**. For:

- SDK or collector behavior → [`obs-unified/obs-unified`](https://github.com/obs-unified/obs-unified)
- Marketing copy → [`obs-unified/presence`](https://github.com/obs-unified/presence)
- Deploy or runner setup → [`obs-unified/ci`](https://github.com/obs-unified/ci)

## Code of Conduct

This repo follows the [obs-unified Code of Conduct](https://github.com/obs-unified/obs-unified/blob/main/CODE_OF_CONDUCT.md).
