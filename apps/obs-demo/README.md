# `@obs-demo/app`

One demo Worker that exercises **every** observability feature: spans,
logs, legacy AI calls, typed OpenInference AI spans, evaluations, and
sessions. Consolidated from the previous `apps/api` + `apps/ai-example`.

## Endpoints

| Route | What it does |
|---|---|
| `GET /api/health`          | Health + reports which LLM providers have keys |
| `GET /api/items`           | Mock DB query, emits a child span |
| `GET /api/items/:id`       | Single item; 404 for id>3 |
| `GET /api/slow`            | 1.5s sleep — triggers latency in dashboard |
| `GET /api/error`           | 500 — triggers errors in dashboard |
| `POST /api/chat`           | Legacy mock AI response (no real call) |
| `GET /api/demo/chat`       | Fan-out across all LLM providers with one prompt + code eval |
| `GET /api/demo/rag`        | RETRIEVER → LLM with fake docs + `rag_faithfulness` eval |
| `GET /api/demo/tool`       | TOOL → LLM weather summary + `mentions_temperature` eval |
| `GET /api/demo/session`    | 3-turn travel concierge session, all under one `session.id` |
| `GET /api/demo/run-all`    | Every scenario above, back-to-back — the one-shot smoke test |

## Run

From repo root:

```bash
# 1. One-time DB migrations
pnpm setup

# 2. Put your provider keys in apps/obs-demo/.dev.vars
cp apps/obs-demo/.dev.vars.example apps/obs-demo/.dev.vars
$EDITOR apps/obs-demo/.dev.vars

# 3. Start everything
pnpm dev          # collector + demo Worker + dashboard in parallel

# 4. Trigger demo scenarios (separate terminal, or just open these in the browser)
curl http://127.0.0.1:8787/api/demo/run-all
```

Open the dashboard at <http://localhost:5173> → AI tab → filter service to
`obs-demo`.

## Where things live

- **Collector** on `:8790` — receives spans/logs/AI payloads
- **Dashboard** on `:5173` — reads from the collector
- **This Worker** on `:8787` — emits instrumented spans via `@obs/telemetry-sdk`

## Troubleshooting

**Empty AI dashboard even though scenarios ran?**
Re-run `pnpm setup`. The migrations for OpenInference payloads, evaluations,
and sessions (019/020/021) must be applied — without them the AI spans are
silently dropped on the collector side.
