-- Last grant-handoff webhook delivery outcome (RFC 0013 § 6.B).
--
-- JSON `{status: 'delivered'|'failed', attempts, lastError, at}` recorded after
-- the grant webhook is attempted (up to 3 attempts). It never contains the
-- callback URL or secret, so unlike callback_url it is kept after approval so
-- the dashboard can flag a failed handoff.
ALTER TABLE remediation_proposals ADD COLUMN callback_delivery TEXT;
