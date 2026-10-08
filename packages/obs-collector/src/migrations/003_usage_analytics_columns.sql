ALTER TABLE usage_events ADD COLUMN country TEXT;
ALTER TABLE usage_events ADD COLUMN browser TEXT;
ALTER TABLE usage_events ADD COLUMN os TEXT;
ALTER TABLE usage_events ADD COLUMN device_type TEXT;
ALTER TABLE usage_events ADD COLUMN is_bot INTEGER DEFAULT 0;
ALTER TABLE usage_events ADD COLUMN utm_source TEXT;
ALTER TABLE usage_events ADD COLUMN utm_medium TEXT;
ALTER TABLE usage_events ADD COLUMN utm_campaign TEXT;

CREATE INDEX IF NOT EXISTS idx_usage_country ON usage_events (country);
CREATE INDEX IF NOT EXISTS idx_usage_bot ON usage_events (is_bot);
CREATE INDEX IF NOT EXISTS idx_usage_browser ON usage_events (browser);
CREATE INDEX IF NOT EXISTS idx_usage_utm ON usage_events (utm_source);
