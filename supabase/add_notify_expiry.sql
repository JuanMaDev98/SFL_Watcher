-- Add notify_expiry column to track last expiry notification
ALTER TABLE user_subscriptions 
ADD COLUMN IF NOT EXISTS notify_expiry TIMESTAMPTZ;