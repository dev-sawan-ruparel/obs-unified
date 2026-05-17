# ci

Self-hosted GitHub Actions runners for the three sibling projects:

- `obs-unified/obs-unified` (the monorepo)
- `obs-unified/obs-unified-docs` (Fumadocs site)
- `obs-unified/presence` (landing page)

This folder holds the runner binary plus a per-repo runner directory. The
shell scripts in `scripts/` automate the install/register/start lifecycle.
Workflow files in each repo target these runners with `runs-on: self-hosted`.

## Prerequisites

- macOS or Linux host (Darwin arm64 / Linux x86_64+arm64 tested)
- [GitHub CLI](https://cli.github.com/) authenticated with `repo` + `workflow` scopes — admin on each repo is required to mint runner registration tokens
- `jq` and `curl`

Run a one-shot check:

```bash
scripts/check-prereqs.sh
```

It reports host/arch, every required tool, gh auth + scopes, and whether
the Cloudflare `.env.deploy` is set up. Every script in this folder also
accepts `--help`.

## One-time install

Download and extract the actions-runner binary into `.runner-bin/`:

```bash
scripts/install.sh
```

Pins to the latest stable release by default. Pin a specific version with
`RUNNER_VERSION=2.334.0 scripts/install.sh`.

## Register runners

The script reads `runners.json`, mints a registration token via the
GitHub API, copies the binary into `runners/<key>/`, and configures it:

```bash
scripts/register.sh obs-unified
scripts/register.sh obs-unified-docs
scripts/register.sh presence
```

After registration the runner is visible at
`https://github.com/obs-unified/<repo>/settings/actions/runners`. **It shows
as OFFLINE until you actually start it** — that's expected; the next step
brings it online.

If a `register.sh` invocation fails partway (e.g. expired token), the script
auto-removes the half-configured `runners/<key>/` directory so you can
re-run cleanly.

## Run

Foreground (one runner, blocks the terminal — good for debugging):

```bash
scripts/start.sh presence
```

Background daemon (launchd; survives reboot, restarts on crash):

```bash
scripts/install-service.sh presence
```

## Status

Show local + GitHub-side state for all configured runners:

```bash
scripts/status.sh
```

## Remove

```bash
scripts/uninstall.sh presence
```

This unregisters the runner from GitHub (using a remove-token) and deletes
the local `runners/<key>/` directory.

## Layout

```
ci/
├── runners.json           # registry: which repos get a runner + labels
├── .env.deploy.example    # template for Cloudflare token (see below)
├── scripts/               # lifecycle scripts (all accept --help)
│   ├── check-prereqs.sh   # one-shot validate host + tools + auth
│   ├── install.sh         # download + extract actions-runner → .runner-bin/
│   ├── register.sh        # configure a runner for one repo
│   ├── start.sh           # foreground run
│   ├── install-service.sh # background via launchd
│   ├── status.sh          # local + GitHub state
│   ├── uninstall.sh       # tear down
│   ├── check-env.sh       # verify .env.deploy token against the CF API
│   └── attach-dns.sh      # upsert obsunified.com / www / docs CNAMEs
├── .runner-bin/           # downloaded binary (gitignored)
├── .env.deploy            # Cloudflare API token (gitignored)
└── runners/               # per-repo runner instances (gitignored)
    ├── obs-unified/
    ├── obs-unified-docs/
    └── presence/
```

`.runner-bin/` and `runners/*/` are gitignored — only the scripts and the
runners.json registry are tracked.

## Workflow targeting

Every repo's `.github/workflows/*.yml` uses `runs-on: self-hosted` so jobs
land on these runners instead of GitHub-hosted Ubuntu. To target a specific
runner by label, use the labels from `runners.json` — e.g.
`runs-on: [self-hosted, presence]` will pin a job to the presence runner.

## Cloudflare credentials (`.env.deploy`)

Several scripts in `scripts/` talk to the Cloudflare REST API to manage
DNS records, custom domains, and Pages deployments. Those calls need a
scoped API token that lives in `ci/.env.deploy` (gitignored).

### Setup

```bash
cp .env.deploy.example .env.deploy
# Open .env.deploy and paste the token from
# https://dash.cloudflare.com/profile/api-tokens
# Use the "Edit zone DNS" template and add Account:Cloudflare Pages:Edit.
scripts/check-env.sh
```

`check-env.sh` calls `/user/tokens/verify` plus four endpoints that exercise
the scopes (`account read`, `Zone:Read`, `DNS:Edit`, `Pages:Edit`) — if any
fail you'll see which one and how to fix it.

### What uses it

- [`scripts/attach-dns.sh`](scripts/attach-dns.sh) — upserts the
  `obsunified.com`, `www.obsunified.com`, and `docs.obsunified.com` CNAMEs
  pointing at the right `*.pages.dev` projects. Cloudflare normally
  auto-creates these when zone + Pages share an account, but for a
  newly-transferred zone the auto-create path doesn't always fire.
- The presence and docs `pnpm deploy` scripts use the wrangler OAuth login
  for Pages uploads, but you can switch them to token-based deploys by
  exporting `CLOUDFLARE_API_TOKEN` (which `.env.deploy` already does when
  sourced).

All scripts auto-source `.env.deploy` if present — no need to `export` the
vars manually before each run.

## Notes

- macOS arm64 host means Docker integration tests in `obs-unified/ci.yml`
  require Docker Desktop running before jobs dispatch.
- The runner inherits the host's `PATH`, including Homebrew installs of
  `pnpm`, `node`, `go`, `cargo`, etc. — there is no automatic setup-node
  on a self-hosted runner.
- If a registration token error appears, your `gh` token is missing repo
  admin scope. `gh auth refresh -s repo,workflow,admin:repo_hook`.
