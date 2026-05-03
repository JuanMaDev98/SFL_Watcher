-- =====================================================
-- user_alerts table - Price alerts for SFL resources
-- =====================================================
-- Run this SQL in Supabase SQL Editor to create the alerts table
-- IMPORTANT: This table is referenced by telegram.js and alerts.js

CREATE TABLE IF NOT EXISTS user_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,                    -- Telegram chat_id
    resource TEXT NOT NULL,                    -- Resource name (e.g., 'yam', 'honey')
    alert_type TEXT DEFAULT 'dual',            -- 'dual', 'price_above', 'price_below'
    threshold_high NUMERIC DEFAULT 10,         -- Alert when price is X% ABOVE average
    threshold_low NUMERIC DEFAULT -10,         -- Alert when price is X% BELOW average
    threshold_percent NUMERIC,                 -- Legacy: single threshold (kept for migration)
    target_price NUMERIC,                      -- Price target for absolute-price alerts
    target_direction TEXT,                     -- 'above' or 'below'
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    last_notified_at TIMESTAMPTZ,
    last_notified_rise_at TIMESTAMPTZ,
    last_notified_fall_at TIMESTAMPTZ,
    last_notified_target_at TIMESTAMPTZ
);

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_user_alerts_user_id ON user_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_alerts_resource ON user_alerts(resource);
CREATE INDEX IF NOT EXISTS idx_user_alerts_enabled ON user_alerts(enabled);

-- =====================================================
-- Migration: Add missing columns if upgrading from old schema
-- =====================================================
-- Run this if threshold_high/threshold_low columns don't exist:

ALTER TABLE user_alerts 
ADD COLUMN IF NOT EXISTS threshold_high NUMERIC DEFAULT 10,
ADD COLUMN IF NOT EXISTS threshold_low NUMERIC DEFAULT -10,
ADD COLUMN IF NOT EXISTS target_price NUMERIC,
ADD COLUMN IF NOT EXISTS target_direction TEXT,
ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_notified_rise_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_notified_fall_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_notified_target_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

ALTER TABLE user_alerts ALTER COLUMN threshold_percent DROP NOT NULL;

-- =====================================================
-- Row Level Security (RLS)
-- =====================================================
ALTER TABLE user_alerts ENABLE ROW LEVEL SECURITY;

-- Users can only see their own alerts
CREATE POLICY "Users can view own alerts" ON user_alerts
    FOR SELECT USING (auth.uid()::text = user_id);

-- Users can only insert their own alerts
CREATE POLICY "Users can insert own alerts" ON user_alerts
    FOR INSERT WITH CHECK (auth.uid()::text = user_id);

-- Users can only update their own alerts
CREATE POLICY "Users can update own alerts" ON user_alerts
    FOR UPDATE USING (auth.uid()::text = user_id);

-- Users can only delete their own alerts
CREATE POLICY "Users can delete own alerts" ON user_alerts
    FOR DELETE USING (auth.uid()::text = user_id);
