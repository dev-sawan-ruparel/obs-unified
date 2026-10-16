---
"@obsunified/collector": patch
---

Grant webhook delivery now retries up to 3 times (500 ms / 1500 ms backoff) on network errors, timeouts and 5xx, but not on 4xx. Approve and propose responses carry `grantDelivery: { attempted, delivered, attempts, host, error? }`, and the last outcome is persisted (migration 053 `callback_delivery`) and returned by GET as `callbackDelivery`.
