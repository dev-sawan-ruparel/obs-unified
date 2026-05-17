# Changesets

This folder is managed by [@changesets/cli](https://github.com/changesets/changesets).

## Releasing

1. Make code changes in a feature branch.
2. Run `pnpm changeset` and pick the affected packages + bump level
   (`patch` / `minor` / `major`). Changesets writes a markdown file under
   `.changeset/` capturing intent.
3. Commit the changeset alongside your code change in the same PR.
4. When the PR merges to `main`, the `release` workflow opens a
   "Version Packages" PR that consumes pending changesets, bumps
   versions, and updates changelogs. Merging that PR publishes to npm.

## Internal-only packages

`@obs-demo/*` workspace packages are `private: true` and listed in
`config.json#ignore` — changesets won't try to version them.
