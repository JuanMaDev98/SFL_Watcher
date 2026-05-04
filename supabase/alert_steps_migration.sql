ALTER TABLE user_alerts
ADD COLUMN IF NOT EXISTS last_notified_rise_step INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_notified_fall_step INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_notified_target_step INTEGER DEFAULT 0;
