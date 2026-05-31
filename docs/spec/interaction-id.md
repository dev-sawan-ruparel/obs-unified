# `interaction_id` wire spec

Status: stable as of v1.0 Owner: obs-unified core Supersedes the RFC-internal
description in
[`rfcs/0004-identity-propagation.md`](../../rfcs/0004-identity-propagation.md).

This document is the **single source of truth** for the click-scoped correlation
key that ties every signal in obs-unified together. Any SDK in any language that
wants to participate in the platform's "≤2 clicks" pivot — including
community-maintained ones — MUST follow this spec. Conformance is verifiable via
the contract tests at
[`tests/conformance/interaction-id/`](../../tests/conformance/interaction-id/).

## TL;DR

```
[Browser]                                  [Server]
─────────                                  ────────
click button
  → mint interaction_id (ULID-shaped)
  → store in usage event
  → fetch(...)
       headers["x-obs-interaction"] = id
                  │
                  ▼
                                          read header → stamp onto active span
                                          attribute "obs.interaction.id" = id
                                          → child spans inherit
                                          → logs in handler inherit
                                          → AI calls in handler inherit
```

## ID format

- **Length:** exactly 26 characters.
- **Alphabet:** Crockford base32 — `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no I, L,
  O, U).
- **Layout:** 10 chars of millisecond Unix timestamp + 16 chars of cryptographic
  randomness, ULID-shaped.
- **Generator entropy:** if `crypto.getRandomValues` (or platform equivalent) is
  unavailable, falling back to a non-CSPRNG is permitted because the ID is not
  security-bearing — but the SDK MUST log a warning once per session.

Reference implementation:
[`packages/analytics-sdk/src/interaction.ts:54`](../../packages/analytics-sdk/src/interaction.ts).

Regex for validation: `^[0-9A-HJKMNP-TV-Z]{26}$` (case-sensitive; lowercase IDs
are rejected).

## Transport

### HTTP header

- **Name:** `x-obs-interaction` (lowercase by convention; HTTP headers are
  case-insensitive but SDKs SHOULD emit lowercase).
- **Value:** the 26-char ID, unquoted.
- **Direction:** client → server only. Servers MUST NOT echo it in responses (no
  client cares about the response value).

### Span attribute

- **Key:** `obs.interaction.id`
- **Value type:** string (the 26-char ID).
- **Where:** stamped on the **root span** of the inbound request. Child spans
  inherit via OTel's parent-attribute propagation rules (which means SDKs MUST
  stamp before spawning children).

### Log record

- **Key:** `obs.interaction.id`
- **Where:** stamped on every log record produced inside the request whose root
  span carries the attribute. SDKs SHOULD use the active- span attribute lookup
  rather than threading the ID through the logger config.

## SDK contract

A conformant **client** SDK:

1. MUST mint a fresh ID on each interaction-triggering event (click, submit,
   keydown, deliberate API call).
2. MUST set the `x-obs-interaction` header on outbound `fetch`/XHR/HTTP requests
   fired _synchronously or within microtask continuations_ of that event ("Mode
   A").
3. MUST provide an explicit `withInteractionContext(id, fn)` / equivalent API
   for non-microtask continuations ("Mode B" — debounce, setTimeout, state
   machines).
4. MUST NOT silently fall back to "no header" if the context is ambiguous — when
   in doubt, omit. Wrong joins are worse than missing ones.
5. SHOULD expose `currentInteractionId()` for snapshotting.

A conformant **server** SDK:

1. MUST provide a one-line stamp helper that reads the header and attaches
   `obs.interaction.id` to the active span. Reference signatures:
   - TypeScript: `stampInteractionFromRequest(span, request): void`
   - Go: `obs.StampInteraction(ctx, r *http.Request)`
   - Rust: `obs_unified::stamp_interaction(span, req)`
2. MUST be a **no-op** when the header is absent — no exceptions, no warnings,
   no synthetic IDs. Server-originated work (cron, queue) legitimately has no
   interaction.
3. MUST validate the header against the regex above and silently drop malformed
   values (don't trust the network).
4. SHOULD propagate explicitly when fanning out — native `fetch` does NOT
   forward arbitrary headers across service boundaries.

## What this is NOT

- Not a trace context replacement. `traceparent` (W3C Trace Context) is
  separate; both headers may co-exist on the same request.
- Not a session ID. `session_id` is much longer-lived (~30min of inactivity).
  One session can spawn many interactions.
- Not a user ID. Interaction IDs are per-click; an unauthenticated visitor still
  generates them.

## Storage shape

Every signal table that carries identity columns has `interaction_id` as a
nullable TEXT column. Receivers extract it from:

| Signal       | Source                                                         |
| ------------ | -------------------------------------------------------------- |
| Span         | `obs.interaction.id` attribute                                 |
| Log          | `obs.interaction.id` attribute (or inherited from active span) |
| AI call      | `obs.interaction.id` attribute on the wrapping span            |
| Usage event  | Direct field on the `/v1/usage` request body                   |
| Replay event | Stamped by the browser SDK at capture time                     |

The collector's `connected-routes` plugin reads these columns to materialize the
"click that caused this trace" rail section.

## Conformance test fixtures

Three black-box tests every SDK port MUST pass. Fixtures and a language-agnostic
runner live at
[`tests/conformance/interaction-id/`](../../tests/conformance/interaction-id/):

1. **ID format**: 1,000 generated IDs all match the regex and are monotonic by
   millisecond timestamp.
2. **Header round-trip**: client sets the header on `fetch`; server reads it;
   assertion that the value matches the minted ID.
3. **Absent-header no-op**: server receives a request without the header;
   assertion that the span has no `obs.interaction.id` attribute and the call
   did not throw.

## Versioning

This spec is at v1. Breaking changes (header rename, format change) require a
new spec version and a `obs-schema-version` header on the ingest side so
receivers can multiplex. Today's collector accepts only v1 — older or newer
producers receive HTTP 400.
