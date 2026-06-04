# Evidence Retrieval CCR Benchmark

This benchmark keeps the CCR product claim executable. It runs the evidence
retrieval route against a deterministic checkout trace and compares:

- Raw context an agent would retrieve by expanding trace and log refs.
- CCR context returned by `/internal/evidence/bundle`.
- Preservation of the failed-span debugging signal.

## Scenario

`trace-repeated-404-burst` models a checkout failure with:

- 2 spans, including a failed `payment.authorize` span.
- 500 correlated error logs with the same normalized signature:
  `GET /api/products/<num> 404`.

## Command

```sh
pnpm benchmark:ccr
```

The test prints a `CCR_BENCHMARK_RESULT` JSON object and fails if the evidence
bundle stops compacting the repeated logs or drops the failed payment span as a
debugging anchor.

## Current Result

Latest local run: June 4, 2026.

| Metric | Raw evidence | CCR evidence bundle |
| --- | ---: | ---: |
| JSON bytes | 202,406 | 5,274 |
| Estimated tokens | 50,602 | 1,319 |
| Correlated log records included | 500 | 3 exemplars |
| Retrieval refs available | n/a | 2 |
| Evidence references available | n/a | 5 |

Observed reduction:

- JSON bytes: 97.4%
- Estimated tokens: 97.4%
- Raw-to-CCR token ratio: 38.4x

Preserved debugging signals:

- `Failed span present` finding is included.
- `trace-ccr-benchmark:payment` span reference is included.

Raw benchmark output:

```json
{
  "scenario": "trace-repeated-404-burst",
  "runDate": "2026-06-04",
  "input": {
    "traceSpans": 2,
    "rawLogRecords": 500,
    "repeatedLogSignature": "GET /api/products/<num> 404"
  },
  "rawEvidence": {
    "jsonBytes": 202406,
    "tokenEstimate": 50602,
    "logRecords": 500
  },
  "ccrEvidenceBundle": {
    "jsonBytes": 5274,
    "tokenEstimate": 1319,
    "logCompactionInput": 500,
    "logCompactionOutput": 3,
    "retrievalRefs": 2,
    "evidenceReferences": 5,
    "estimatedTokensInBundleBudget": 1313
  },
  "reduction": {
    "jsonBytesPct": 97.4,
    "tokenEstimatePct": 97.4,
    "rawToCcrTokenRatio": 38.4
  },
  "preservedSignals": {
    "failedSpanFinding": true,
    "failedPaymentSpanReference": true
  }
}
```

Re-run this benchmark before changing CCR-related product messaging.
