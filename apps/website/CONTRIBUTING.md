# Contributing to presence

Thanks for considering a contribution. The canonical contribution guide for the entire obs-unified org lives in [`obs-unified/CONTRIBUTING.md`](https://github.com/obs-unified/obs-unified/blob/main/CONTRIBUTING.md) — that covers commit message style, the RFC tree, testing expectations, and review process.

A few `presence`-specific notes on top of that:

## Local setup

```bash
pnpm install
pnpm dev          # http://localhost:4173
```

Requires Node 22+ and pnpm 10+ (`.nvmrc` pins the Node version; pnpm pin is in `package.json`'s `packageManager` field).

## Before opening a PR

```bash
pnpm types:check  # tsc --noEmit
pnpm build        # full production build
```

Both should pass clean. CI runs the same two commands on a self-hosted runner managed under [`obs-unified/ci`](https://github.com/obs-unified/ci).

## What lives here

`presence` is **only the marketing / landing page**. If your change is about:

- An SDK or the collector → [`obs-unified/obs-unified`](https://github.com/obs-unified/obs-unified)
- The documentation site → [`obs-unified/obs-unified-docs`](https://github.com/obs-unified/obs-unified-docs)
- A deploy or runner workflow → [`obs-unified/ci`](https://github.com/obs-unified/ci)

Pick the right repo before opening the PR.

## AEO discipline

This site is optimized for Answer-Engine Optimization. When changing copy, keep:

- JSON-LD blocks in [`index.html`](./index.html) updated alongside any FAQ or feature changes
- [`public/llms.txt`](./public/llms.txt) in sync with the visible content — that's what AI search reads
- Semantic landmarks (`header`, `main`, `section[aria-labelledby]`, `footer`) intact

## Code of Conduct

This repo follows the [obs-unified Code of Conduct](https://github.com/obs-unified/obs-unified/blob/main/CODE_OF_CONDUCT.md).
