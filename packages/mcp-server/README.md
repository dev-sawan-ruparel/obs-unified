# @obs-unified/mcp-server

Read-only investigation MCP server for AI agents that need access to an
obs-unified collector.

It exposes collector investigation endpoints as Model Context Protocol tools:
recent traces, trace detail, service operations, service map, logs, AI sessions,
users, replays, connected signals, agent runs, actions, and tool calls.

This package is distinct from:

- SDK MCP context propagation helpers in `@obs-unified/telemetry-sdk/mcp`.
- Collector normalization of OpenTelemetry MCP span attributes such as
  `mcp.method.name`.

See [MCP in obs-unified](../../docs/mcp.md) for the terminology split.

## Install

```bash
pnpm config set @obs-unified:registry https://npm.pkg.github.com
pnpm add -g @obs-unified/mcp-server
```

The package is published to the obs-unified GitHub Packages registry.

## Configure

Set the collector URL and one auth method:

```bash
export OBS_COLLECTOR_URL="https://obs.example.com"
export OBS_DASHBOARD_TOKEN="..."
```

Supported auth variables, in priority order:

- `OBS_DASHBOARD_TOKEN` — programmatic dashboard token, sent as a bearer token.
- `OBS_INGEST_KEY` — project ingest key, sent as a bearer token for collectors
  that allow it on read endpoints.
- `OBS_SESSION_COOKIE` — dashboard `obs_session` cookie value for ad-hoc local
  use.

Optional variables:

- `OBS_PROJECT_ID` — sent as `X-Project-Id` for multi-project collectors.
- `OBS_DASHBOARD_URL` — used to include dashboard deep links in tool responses.
- `OBS_MCP_TIMEOUT_MS` — request timeout in milliseconds. Defaults to `30000`.

## Claude Desktop / compatible local MCP host

```json
{
  "mcpServers": {
    "obs-unified": {
      "command": "obs-unified-mcp",
      "env": {
        "OBS_COLLECTOR_URL": "https://obs.example.com",
        "OBS_DASHBOARD_TOKEN": "..."
      }
    }
  }
}
```

For local development from this repo:

```json
{
  "mcpServers": {
    "obs-unified": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/obs-unified", "--filter", "@obs-unified/mcp-server", "start"],
      "env": {
        "OBS_COLLECTOR_URL": "http://localhost:8790",
        "OBS_INGEST_KEY": "dev"
      }
    }
  }
}
```

Build the package first with `pnpm --filter @obs-unified/mcp-server build`.

## Tools

- `obs_status`
- `recent_traces`
- `get_trace`
- `service_operations`
- `service_map`
- `search_logs`
- `ai_overview`
- `get_ai_session`
- `get_user`
- `get_replay`
- `connected_signals`
- `get_agent_run`
- `get_action`
- `get_tool_call`

This is a stdio MCP server. It writes operational errors to stderr only, because
stdout is reserved for JSON-RPC messages.
