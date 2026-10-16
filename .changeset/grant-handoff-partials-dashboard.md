---
"@obsunified/dashboard": patch
---

The remediation approval card can send an optional webhook URL and secret with the approve request (showing the stored callback host as read-only), warns when grant webhook delivery failed so the operator can hand over the one-time token, and the queue marks proposals with a "delivery failed" badge.
