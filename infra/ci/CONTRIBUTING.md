# Contributing to ci

Thanks for considering a contribution. The canonical contribution guide for the entire obs-unified org lives in [`obs-unified/CONTRIBUTING.md`](https://github.com/obs-unified/obs-unified/blob/main/CONTRIBUTING.md) — commit message style, RFC tree, review process.

A few `ci`-specific notes on top of that:

## What lives here

`ci` is **infrastructure, not product code**. Two roles:

1. **Self-hosted GitHub Actions runners** — one runner per repo under `runners/<key>/`, configured via `scripts/register.sh`. The runner binary itself lives in `.runner-bin/` (gitignored).
2. **Cloudflare deploy automation** — shell scripts that hit the Cloudflare REST API for things wrangler's OAuth scope can't do (DNS edits, custom-domain attach, etc.).

If your change is about the product itself (SDKs, collector, dashboard), the right repo is [`obs-unified/obs-unified`](https://github.com/obs-unified/obs-unified). If it's about the docs or landing page, see [`obs-unified-docs`](https://github.com/obs-unified/obs-unified-docs) or [`presence`](https://github.com/obs-unified/presence).

## Tooling

- macOS or Linux host (Darwin arm64 and Linux x86_64/arm64 are tested)
- `bash` 4+ (`/usr/bin/env bash` shebang on every script)
- `gh` (GitHub CLI) authenticated with `repo` + `workflow` scope
- `jq`
- `curl`

Run `scripts/check-prereqs.sh` (when present) to verify all of the above in one command.

## Shell style

- All scripts use `#!/usr/bin/env bash` and `set -euo pipefail` (where appropriate)
- Functions are lowercase + verb-first (`upsert`, `probe`, `check`)
- Top-of-file comment block explains what the script does and what env it needs
- Each script accepts `--help` and prints usage to stdout (exit 0)
- Errors go to stderr, with a hint about how to recover

## Secrets

Never commit `.env.deploy`, `.runner-bin/`, or anything under `runners/`. The `.gitignore` covers these; double-check `git status` before pushing if you touched any of those paths.

For new credentials, follow the `.env.deploy` pattern: add an entry to `.env.deploy.example` with comments explaining what scope is needed, and source `.env.deploy` at the top of any script that uses it.

## Before opening a PR

- `bash -n scripts/*.sh` should pass (syntax check)
- Run the script you touched against a non-production target if possible
- Update [`README.md`](./README.md) if the user-facing command surface changed

## Code of Conduct

This repo follows the [obs-unified Code of Conduct](https://github.com/obs-unified/obs-unified/blob/main/CODE_OF_CONDUCT.md).
