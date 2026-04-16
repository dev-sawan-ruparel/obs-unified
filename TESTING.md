# Testing

obs-unified uses **Playwright** for end-to-end tests and **Vitest** for unit tests.

## Quick Start

```bash
# Install dependencies (first time)
pnpm install

# Install Playwright browsers (first time)
pnpm exec playwright install chromium

# Run all E2E tests
pnpm exec playwright test

# Run unit tests across all packages
pnpm test
```

## E2E Tests (Playwright)

E2E tests live in `apps/web/tests/` and verify the dashboard UI renders correctly with mocked API responses. **No backend services need to be running** — all API calls are intercepted by Playwright route handlers.

### Running

```bash
# Run all tests (headless)
pnpm exec playwright test

# Run with visible browser
pnpm exec playwright test --headed

# Run in Playwright's interactive UI
pnpm exec playwright test --ui

# Run a specific test by name
pnpm exec playwright test -g "Logs Dashboard"

# Debug a failing test (step through in browser)
pnpm exec playwright test -g "renders traces" --debug
```

### What the Tests Cover

| Suite | Tests | What It Verifies |
|-------|-------|-----------------|
| Navigation | 3 | Default route, tab rendering, hash navigation |
| Traces | 1 | Trace list renders with mocked overview data |
| Issues | 1 | Issue list renders with mocked issues data |
| Logs | 1 | Log entries render with severity badges |
| AI Calls | 1 | AI call stats, model names, cost display |
| Usage | 1 | Usage tab mounts (SSE not fully mockable) |
| Replays | 1 | Replay session list renders |
| Resources | 1 | Resources tab mounts |
| Playground | 2 | API buttons render, health endpoint call works |

### How Mocking Works

Tests use a `mockApis()` helper that intercepts all `/api/` requests at the Playwright level (before Vite's proxy). Each test can override specific endpoints:

```typescript
await mockApis(page, {
  "/logs/overview": (route) => json(route, myCustomData),
});
```

The helper returns proper empty data for all endpoints by default, so the React app never crashes from missing data. See the `EMPTY` constants at the top of `dashboards.spec.ts` for the expected response shapes.

### Adding a New Test

1. Add your test to `apps/web/tests/dashboards.spec.ts` (or create a new `.spec.ts` file)
2. Call `await mockApis(page)` to stub all APIs
3. Pass overrides for the specific endpoint you want to test with custom data
4. Navigate to the correct hash route: `await page.goto("/#/logs")`
5. Assert on visible text, not internal state

**Key gotcha:** The dashboard components live in `packages/dashboard/`, not `apps/web/`. Check the actual component code for:
- The API path it fetches (e.g., `/logs/overview`, not `/telemetry/logs`)
- The exact text it renders (e.g., `TOTAL CALLS` not `Total Calls`)
- Which fields it displays (e.g., replays show `starting_link`, not `session_id`)

### Viewing Reports

After a test run, open the HTML report:

```bash
pnpm exec playwright show-report
```

Failed tests with `--trace on` generate trace files you can inspect:

```bash
pnpm exec playwright show-trace test-results/<test-name>/trace.zip
```

## Unit Tests (Vitest)

Unit tests use Vitest and are configured per-package. Currently packages have `--passWithNoTests` set, so they pass with no test files.

```bash
# Run all package unit tests
pnpm test

# Run tests for a specific package
pnpm --filter @obs/collector test
pnpm --filter @obs/telemetry-sdk test
pnpm --filter @obs/analytics-sdk test
pnpm --filter @obs/types test
```

## Type Checking

```bash
# Type-check all packages
pnpm run type-check
```

## CI

The Playwright config has CI-specific settings:
- 2 retries on failure
- 1 worker (no parallelism)
- Traces on first retry

Set `CI=true` to enable:

```bash
CI=true pnpm exec playwright test
```
