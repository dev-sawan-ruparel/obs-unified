-- Persisted grant-handoff callback (RFC 0013 § 6.B, journey review J17).
--
-- A proposal parked for human approval may carry a webhook that receives the
-- one-time grant token when the approval happens later. `callback_url` is the
-- target (SSRF-guarded again at delivery time); `callback_secret` is the HMAC
-- signing secret, stored as supplied (the collector has no at-rest encryption
-- helper) and never returned by any GET. Both are cleared once the grant is
-- delivered, rejected or expired.
ALTER TABLE remediation_proposals ADD COLUMN callback_url TEXT;
ALTER TABLE remediation_proposals ADD COLUMN callback_secret TEXT;
