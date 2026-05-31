# Public Release Checklist

Use this checklist before merging substantial public-facing changes to `main`.

## Source readiness

- `main` has been fetched from GitHub and the branch is not behind
  `origin/main`.
- Local-only development artifacts are not staged. In this repo,
  `.claude/skills/`, `node_modules/`, build outputs, Playwright reports, and
  runtime logs are ignored.
- Every changed publishable package has a Changesets entry.
- Public package manifests include `description`, `license`, `repository`,
  `files`, `exports`, and `publishConfig` where appropriate.
- README install instructions and package READMEs match the current package
  names and registry behavior.

## Verification

Run the same checks CI expects:

```bash
pnpm install --frozen-lockfile
pnpm -r run type-check
pnpm -r run test
pnpm -r run build
pnpm run lint
```

For SDK changes, also run:

```bash
cd sdks/go && go vet ./... && go test ./... && go build ./...
cd ../rust && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test --all-features
```

For collector runtime changes, run at least one live smoke path:

```bash
pnpm smoke:local-image
pnpm e2e:otlp
pnpm e2e:alerts
```

## Publishing flow

Packages publish through GitHub Packages from the `Release` workflow on pushes
to `main`. The workflow runs Changesets, opens or updates the release PR, and
publishes after the generated release PR is merged.

Before merging the release PR:

- Confirm the generated changelogs describe the user-visible changes.
- Confirm the package versions are intentional.
- Confirm the workflow has `packages: write` and Node is configured for
  `https://npm.pkg.github.com` with scope `@obs-unified`.

## Post-release

- Install the public packages from a clean project using the documented GitHub
  Packages `.npmrc` configuration.
- Smoke-test the collector health endpoint, dashboard login, and at least one
  SDK ingest path.
- Check the GitHub Packages page for each published package.
