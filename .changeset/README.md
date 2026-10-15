# Changesets

This folder is managed by
[@changesets/cli](https://github.com/changesets/changesets).

## Releasing

1. Make code changes in a feature branch.
2. Run `pnpm changeset` and pick the affected packages + bump level (`patch` /
   `minor` / `major`). Changesets writes a markdown file under `.changeset/`
   capturing intent.
3. Commit the changeset alongside your code change in the same PR.
4. After the PR merges to `main`, a maintainer runs `pnpm version-packages`
   in a worktree to consume pending changesets, bump versions, and update
   changelogs, merges that version PR, then runs `pnpm release` from an
   interactive terminal. `pnpm release` publishes packages sequentially via
   `scripts/release-npm/publish-sequential.sh` (not `changeset publish`) and
   tags them. There is no GitHub Actions release workflow; see
   [docs/release.md](../docs/release.md).

## Internal-only packages

`@obs-demo/*` workspace packages are `private: true` and listed in
`config.json#ignore` — changesets won't try to version them.
