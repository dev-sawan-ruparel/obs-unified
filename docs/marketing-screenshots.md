# Marketing Screenshot Pipeline

This pipeline captures real obs-unified product screenshots from the local
Astronomy Shop demo and writes them into the website asset tree.

## Screenshot Set

The current set captures 24 review targets:

1. Health overview with agentic investigation entry points
2. Astronomy Shop service map
3. Traces from live Astronomy traffic
4. Trace waterfall with Connected Rail
5. Interaction ID path from click to backend
6. Correlated structured logs
7. AI cost and LLM spans
8. Agent action graph
9. Agent graph governance tab
10. Session replay list
11. Unified session timeline
12. Usage analytics in the same stack
13. Alert rules and operational triggers
14. Investigation narratives
15. Infrastructure resources
16. Project routing and ingest keys
17. Replay capture playground
18. Issues grouped from traces
19. AI sessions and heavy spender
20. CPU profile join point
21. Live tail logs
22. Dense dashboard chrome
23. Mobile health view
24. Dashboard as the docs proof point

## Runbook

From the `obs-unified` repo:

```bash
pnpm demo:preflight
pnpm demo:up
pnpm run dev:collector
```

In another shell, seed the local store and capture the website images:

```bash
set -a
. apps/collector/.dev.vars
set +a

OBS_INGEST_KEY="$INGEST_KEY" pnpm seed

DASHBOARD_PASSWORD="$DASHBOARD_PASSWORD" \
OBS_INGEST_KEY="$INGEST_KEY" \
MARKETING_SCREENSHOT_OUT=/Users/sawan/projects/obs-unified/presence/public/screenshots/app \
pnpm --filter @obs-demo/web run screenshots:marketing
```

Use `MARKETING_SCREENSHOT_SET=website` to capture only the website-approved
subset. By default the command captures the full review set.

## Review Notes

Homepage-ready images:

- `agent-action-graph.png`: strongest proof of the agentic debugging
  positioning; it opens the nested `#/actions/marketing-agent-run-root` route
  seeded by the capture script.
- `interaction-id-path.png`: explains the `interaction_id` path from frontend
  action into traces and related signals.
- `trace-waterfall-connected-rail.png`: primary click-to-root-cause proof:
  waterfall plus neighboring signals in the rail.
- `service-map-astronomy.png`: best proof that the screenshots come from a
  real OpenTelemetry microservice demo.
- `ai-cost-spans.png`: validates the AI cost, tokens, model, and span story.
- `timeline-unified.png`: shows that product events, traces, logs, and AI calls
  live on one timeline.
- `logs-correlated.png`: makes logs feel connected rather than bolted on.
- `usage-analytics.png`: shows product analytics sharing the same identity
  graph.
- `trace-profile-slot.png`: shows where profile evidence joins the trace path.

Needs product/data follow-up before it should lead public pages:

- `replay-sessions.png`: only lead with this after a browser replay is recorded.
- `agent-governance.png`: useful as a secondary enterprise/governance proof,
  but the homepage should lead with the causal action tree first.
- `health-agentic-overview.png`: useful for dashboard breadth, but weaker than
  the concrete graph and interaction-path screenshots.
