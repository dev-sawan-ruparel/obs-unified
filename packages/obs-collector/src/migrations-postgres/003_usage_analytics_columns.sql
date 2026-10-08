ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS browser TEXT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS os TEXT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS device_type TEXT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT FALSE;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS utm_campaign TEXT;

CREATE INDEX IF NOT EXISTS idx_usage_country ON usage_events (country);
CREATE INDEX IF NOT EXISTS idx_usage_bot ON usage_events (is_bot);
CREATE INDEX IF NOT EXISTS idx_usage_browser ON usage_events (browser);
CREATE INDEX IF NOT EXISTS idx_usage_utm ON usage_events (utm_source);
