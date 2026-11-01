---
"@obsunified/collector": minor
"@obsunified/types": minor
"@obsunified/dashboard": minor
---

Alert rules gain a `metrics` signal over OTLP metrics (`last`, `min`, `max`, `avg`, `sum`, `increase`, `rate`, `age_seconds`; summed metric lists, attribute and resource-attribute filters, histogram `count`/`sum`, and ratios with `minDenominator`), `==` / `!=` comparisons, a rule-level `pendingSecs` (Prometheus `for`; migrations 054-055, plus index 056), and an `email` channel sent through the Node collector's `ALERT_SMTP_*` settings. Collectors without SMTP (including Cloudflare Workers) refuse email channels. The dashboard's rule form and detail view support metric rules, the pending duration and email channels.

Review follow-ups: metrics queries take `staleSecs` (default 300) and `noData` (`zero` | `keep`); evaluations record an `outcome` (`value`, `no_data`, `error`; migration 057); pending holds reset on rule edits, evaluation gaps and Node restarts (migration 058); ratios divide by the real denominator and yield 0 when it is <= 0; a cumulative series first seen inside the window counts its first value; metric rule windows are capped at 1440 minutes and evaluations past 1000 series or 50,000 points fail as `error`.
