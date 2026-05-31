# `interaction_id` conformance tests

Language-agnostic black-box tests every obs-unified SDK MUST pass. See
[`docs/spec/interaction-id.md`](../../../docs/spec/interaction-id.md) for the
wire spec.

## Test cases

Each case is described in `cases.json` as a tuple of (input, expected output).
SDKs are expected to expose a small test harness (a tiny binary or test runner)
that ingests a case and reports pass/fail.

### Case 1 — ID format

Generate 1,000 IDs via the SDK's mint helper. Assertions:

- Each matches `^[0-9A-HJKMNP-TV-Z]{26}$`.
- The first 10 chars of each ID, decoded as Crockford base32, equals the mint
  time in milliseconds within ±1ms.
- No two consecutive IDs in the same millisecond have identical randomness
  suffixes (probabilistic — failure rate < 1 in 2^64).

### Case 2 — Header round-trip

Set up:

1. Browser-shaped client sends a `fetch`/equivalent with header
   `x-obs-interaction: 01HZQ5W3K8M4P2X7N9B0CDEFGH`.
2. Server SDK is invoked on the inbound request.
3. After server-side handler completes, inspect the recorded span.

Assertion:

- Root span carries attribute `obs.interaction.id` with value exactly
  `01HZQ5W3K8M4P2X7N9B0CDEFGH`.

### Case 3 — Absent-header no-op

Set up:

1. Inbound request has no `x-obs-interaction` header.
2. Server SDK invoked normally.

Assertions:

- No exception thrown.
- Root span does NOT have an `obs.interaction.id` attribute.
- No warning logged at level WARN or higher.

### Case 4 — Malformed-header no-op

Repeat case 3 with hostile values:

- `lowercase-id-here-26-chars-x`
- `01HZQ5W3K8M4P2X7N9B0CDEFG` (25 chars)
- `01HZQ5W3K8M4P2X7N9B0CDEFGHX` (27 chars)
- `01ILOU` (forbidden Crockford letters)
- empty string

Each MUST be silently dropped — no exception, no synthesized ID, no attribute on
the span.

## Running

Each SDK ports its own runner:

| SDK                          | Test entry                                      |
| ---------------------------- | ----------------------------------------------- |
| `@obs-unified/analytics-sdk` | `vitest run interaction.conformance`            |
| `@obs-unified/telemetry-sdk` | `vitest run interaction.conformance`            |
| `@obs-unified/sdk` (Node)    | `vitest run interaction.conformance`            |
| `obs` (Go)                   | `go test -run TestInteractionConformance ./...` |
| `obs-unified` (Rust)         | `cargo test interaction_conformance`            |

The CI matrix at `.github/workflows/ci.yml` runs all five in parallel on every
PR.
