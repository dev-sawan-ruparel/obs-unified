# Releases

Releases run from the personal monorepo. GitHub Actions and GitHub runner
services are not used.

## Validate locally

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm check:surfaces
pnpm -r --sort --filter '!presence' --filter '!obs-unified-docs' build
pnpm -r --filter '!presence' --filter '!obs-unified-docs' type-check
pnpm -r --filter '!presence' --filter '!obs-unified-docs' test
pnpm --filter presence types:check
pnpm --filter obs-unified-docs types:check
pnpm build:website
pnpm build:docs
make -C skills lint validate build
```

## npm packages

Public packages retain the `@obsunified` scope. Add a changeset for behavior
changes, run `pnpm version-packages` in a worktree, and merge the version
changes through a PR. Authenticate to npm with scope publishing access and
run `pnpm release`. Website/docs are private workspace members and are
excluded from publishing.

The standalone Node wrapper is versioned separately: build with
`pnpm --filter @obsunified/sdk build`, then publish from `sdks/node` with
`npm publish --access public`. Check existing published versions before retrying.

## Go SDK

The module is `github.com/dev-sawan-ruparel/obs-unified/sdks/go`.
Run `go vet ./...`, `go test ./...`, and `go build ./...` in `sdks/go`, then
create an annotated `sdks/go/v<version>` tag on the verified commit and push
it to the personal repository. Verify with:

```bash
go list -m -versions github.com/dev-sawan-ruparel/obs-unified/sdks/go
```

Applications upgrading from the previous module identity must update imports.

## Rust SDK

Run `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`,
`cargo test --all-features`, and `cargo package` in `sdks/rust`.
`cargo publish` requires crates.io access to the existing `obs-unified` crate.

## Agent skills

Run `make -C skills lint validate build`. Create a release using a distinct
`skills-v<version>` tag and attach `skills/dist/*.skill` with `gh release create`
or `gh release upload`. Update the documented download tag when shipping new
bundles. The migration release is `skills-v0.1.1`.

## Container image

Build `Dockerfile.local` and publish to `ghcr.io/dev-sawan-ruparel/local:latest`
with package publishing access. Mark it public and verify an anonymous pull.
Local builds use `pnpm local:image` and `pnpm local:run`.

## Website and docs

Run `pnpm deploy:website` or `pnpm deploy:docs` after validation. These build
locally and upload to existing Cloudflare Pages projects. See
[Cloudflare deployment](../infra/cloudflare/README.md).
