<!--
Thanks for the PR. A few things that make review faster:
- Link any related issue with "Closes #123".
- Mention the @obs-unified/* package(s) you touched.
- If this changes a public API, include a changeset (`pnpm changeset`).
-->

## What

<!-- One or two sentences describing the change. -->

## Why

<!-- The user-visible reason this matters. -->

## How

<!-- The shape of the change, key files, anything worth flagging in review. -->

## Checklist

- [ ] Tests added or updated
- [ ] `pnpm -r run type-check` passes locally
- [ ] `pnpm -r run test` passes locally
- [ ] Changeset added if this affects a published package
- [ ] Docs updated (obs-unified-docs) if behavior changed
