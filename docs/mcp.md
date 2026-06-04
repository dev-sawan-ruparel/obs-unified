# MCP in obs-unified

`MCP` always means Model Context Protocol in this repository, but obs-unified
uses it in three different places. Keep these names distinct when editing docs,
code, issues, or prompts.

## 1. Investigation MCP Server

Package: [`@obsunified/mcp-server`](../packages/mcp-server)

This is a read-only Model Context Protocol server for coding agents and desktop
MCP hosts. It exposes collector query endpoints as tools, such as compact
evidence bundles, retrieval ref expansion/search, recent traces, trace detail,
evidence-ref expansion stats, recent traces, trace detail, service maps, logs,
AI sessions, users, replays, connected signals, agent runs, actions, and tool
calls.

Use this when an external agent needs to investigate an obs-unified collector
without receiving ingest credentials or direct database access.

The RFC 0011 evidence retrieval tools are part of the investigation MCP server,
not MCP context propagation. They read already-ingested observability data and
return compact bundles plus retrieval refs; they do not propagate JSON-RPC
`params._meta` into application tool calls.

The investigation MCP server also exposes `get_evidence_stats`, backed by the
collector's materialized evidence-ref tables, so agents can see which refs were
issued and which refs were expanded most often.

## 2. MCP Context Propagation

Package: [`@obs-unified/telemetry-sdk`](../packages/telemetry-sdk), module
`@obs-unified/telemetry-sdk/mcp`

These helpers instrument applications that call MCP tools, resources, or
prompts. They inject and extract W3C trace context plus Agent Action Graph IDs
inside JSON-RPC `params._meta`, where per-request HTTP headers may not exist.

Use this when your own agent runtime or MCP host needs to preserve
`traceparent`, `root_action_id`, `action_id`, `caused_by_action_id`, and
`interaction_id` across an MCP boundary.

## 3. OTel MCP Normalization

Package: [`@obs-unified/collector`](../packages/obs-collector)

The collector recognizes OpenTelemetry MCP semantic-convention attributes such
as `mcp.method.name`, `mcp.tool.name`, `mcp.resource.uri`, and
`mcp.prompt.name`. It normalizes those spans into Agent Action Graph records
when explicit action context is present or can be derived from trace/span
identity.

Use this when telemetry is already emitted as OpenTelemetry MCP spans and must
appear in the dashboard graph.

## Naming Rules

- Say **investigation MCP server** for `@obsunified/mcp-server`.
- Say **MCP context propagation** for SDK helpers in
  `@obs-unified/telemetry-sdk/mcp`.
- Say **OTel MCP normalization** for collector ingest of `mcp.*` span
  attributes.
- Avoid saying only "the MCP server" in Agent Action Graph docs unless the
  referenced component is `@obsunified/mcp-server`.
