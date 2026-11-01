---
"@obsunified/collector": minor
"@obsunified/types": minor
"@obsunified/dashboard": minor
---

Alert rules gain a `metrics` signal over OTLP metrics (`last`, `min`, `max`, `avg`, `sum`, `increase`, `rate`, `age_seconds`; summed metric lists, attribute and resource-attribute filters, histogram `count`/`sum`, and ratios with `minDenominator`), `==` / `!=` comparisons, a rule-level `pendingSecs` (Prometheus `for`; migrations 054-055, plus index 056), and an `email` channel sent through the Node collector's `ALERT_SMTP_*` settings. Collectors without SMTP (including Cloudflare Workers) refuse email channels. The dashboard's rule form and detail view support metric rules, the pending duration and email channels.
