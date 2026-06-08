-- Add ads_enabled column to user_subscriptions (default true = user receives ads)
-- Premium users (status='active') can set this to false to opt out of promotions
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS ads_enabled BOOLEAN NOT NULL DEFAULT true;

-- Add flag to avoid spamming users repeatedly when subscription expires
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS subscription_notified_expired BOOLEAN NOT NULL DEFAULT false;
