-- Old databases may still have a CHECK constraint that only allows legacy alert_type values.
-- This blocks new target alerts like price_above / price_below.

ALTER TABLE user_alerts
DROP CONSTRAINT IF EXISTS user_alerts_alert_type_check;
