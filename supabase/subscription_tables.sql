-- user_subscriptions table
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'trial', -- 'trial', 'active', 'expired'
  preferred_language TEXT NOT NULL DEFAULT 'es',
  pending_action TEXT,
  pending_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ntfy_enabled BOOLEAN NOT NULL DEFAULT false,
  ntfy_graph_enabled BOOLEAN NOT NULL DEFAULT true,
  notify_expiry TIMESTAMPTZ,
  trial_started_at TIMESTAMPTZ DEFAULT NOW(),
  trial_ends_at TIMESTAMPTZ,
  subscription_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- payments table
CREATE TABLE IF NOT EXISTS user_payments (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  network TEXT NOT NULL, -- 'base' or 'ronin'
  amount_token NUMERIC,
  amount_usd NUMERIC,
  days_added INTEGER DEFAULT 30,
  verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Function to check if user has active subscription
CREATE OR REPLACE FUNCTION has_active_subscription(p_user_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  sub RECORD;
BEGIN
  SELECT * INTO sub FROM user_subscriptions WHERE user_id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  IF sub.status = 'active' AND sub.subscription_ends_at > NOW() THEN
    RETURN true;
  END IF;
  
  IF sub.status = 'trial' AND sub.trial_ends_at > NOW() THEN
    RETURN true;
  END IF;
  
  RETURN false;
END;
$$ LANGUAGE plpgsql;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_payments_user_id ON user_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_payments_tx_hash ON user_payments(tx_hash);

ALTER TABLE user_subscriptions
ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'es',
ADD COLUMN IF NOT EXISTS pending_action TEXT,
ADD COLUMN IF NOT EXISTS pending_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS ntfy_enabled BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS ntfy_graph_enabled BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS notify_expiry TIMESTAMPTZ;