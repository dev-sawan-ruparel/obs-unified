# Scenario B Seed Fixture Proof

| Field | Current fixture |
| --- | --- |
| Scenario ID | `scenario-b-ai-cost-spike` |
| Seed command | Start the local collector/demo/dashboard stack, then run `node scripts/seed-everything/run.mjs --collector http://localhost:8790 --demo http://localhost:8787 --password e2e-test-pass --rounds 6`. The seed may be rerun; telemetry span inserts are idempotent by trace/span and action graph rows upsert by action ID. |
| Environment assumptions | Local collector at `http://localhost:8790`, dashboard at `http://localhost:5173`, demo service at `http://localhost:8787`, project `default`, dashboard password `e2e-test-pass`. Live browser checks remain gated on `E2E_LIVE_STACK=1`. |
| Stable entities/IDs | User anchor `heavy-spender@seed.local` / `Heavy Spender (seed)`. Deterministic proof trace `0b000000000000000000000000000001`. Agent run action `01K00000000000000000000001`, LLM action `01K00000000000000000000002`, tool action `01K00000000000000000000003`, eval action `01K00000000000000000000004`. LLM span `0b00000000000002`, tool span `0b00000000000003`, eval span `0b00000000000004`. |
| Expected agent-debugging path | AI cost aggregate identifies the heavy-spender session, the session rail exposes the deterministic AI trace, the span/action rail exposes the LLM action, the action rail exposes the parent agent run plus downstream tool and eval records, and the eval failure explains the spend spike as a recommendation budget guard failure. |
| Required screenshots/artifacts | For a live proof capture: `/internal/ai/overview?hours=24`, `/internal/connected/user/<heavy-user-id>`, `/internal/connected/span/0b000000000000000000000000000001:0b00000000000002`, `/internal/actions/01K00000000000000000000002`, plus dashboard screenshots for the AI aggregate row and connected rail. |
| Freshness criteria | Proof capture must record the commit SHA, seed command output showing `1 action proof chain`, and API timestamps after the seed run. |
| Pass/fail criteria | Heavy-spender aggregate is the top session by cost; deterministic trace is reachable from that path; action `01K00000000000000000000002` has root `01K00000000000000000000001`; tool `catalog.lookup_recommendations` and eval `recommendation_budget_guard` are present; eval `passed` is false with the budget-guard reasoning. |

