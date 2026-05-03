ALTER TABLE user_subscriptions
ADD COLUMN IF NOT EXISTS critical_alerts_enabled BOOLEAN NOT NULL DEFAULT true;
