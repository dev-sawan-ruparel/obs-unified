---
"@obsunified/collector": patch
---

The local seed's slow checkout now includes two logs correlated to the payment span and a trace-labeled CPU profile with realistic sample values. Evidence bundles for the checkout trace cite the logs and profile, and the profile frames attribute most payment CPU to `JSON.parse`.
