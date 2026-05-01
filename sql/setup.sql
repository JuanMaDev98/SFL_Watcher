-- ============================================
-- SFL Watcher Database Setup
-- Run this AFTER truncating price_snapshots
-- ============================================

-- 1. Create optimized index for (resource, created_at) queries
-- This dramatically speeds up get_price_stats and price history queries
CREATE INDEX IF NOT EXISTS idx_price_snapshots_resource_created 
ON price_snapshots (resource, created_at DESC);

-- 2. Create efficient stats aggregation function
-- This replaces the need to load ALL rows into memory
CREATE OR REPLACE FUNCTION get_price_stats(
  resource_name TEXT,
  days_limit INTEGER DEFAULT 90
)
RETURNS TABLE (
  resource TEXT,
  current_price NUMERIC,
  avg_price NUMERIC,
  min_price NUMERIC,
  max_price NUMERIC,
  percent_vs_avg NUMERIC,
  snapshot_count BIGINT,
  is_90day_min BOOLEAN,
  is_90day_max BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cutoff_date TIMESTAMPTZ;
  current_val NUMERIC;
  avg_val NUMERIC;
  min_val NUMERIC;
  max_val NUMERIC;
  min_90d NUMERIC;
  max_90d NUMERIC;
  count_val BIGINT;
BEGIN
  cutoff_date := NOW() - (days_limit || ' days')::INTERVAL;
  
  -- Get current price (most recent)
  SELECT price INTO current_val
  FROM price_snapshots
  WHERE resource = resource_name
  ORDER BY created_at DESC
  LIMIT 1;
  
  -- Get aggregated stats for the period
  SELECT 
    AVG(price)::NUMERIC,
    MIN(price)::NUMERIC,
    MAX(price)::NUMERIC,
    COUNT(*)::BIGINT
  INTO avg_val, min_val, max_val, count_val
  FROM price_snapshots
  WHERE resource = resource_name
    AND created_at >= cutoff_date;
  
  -- Get 90-day min/max for is90DayMin/is90DayMax
  SELECT MIN(price), MAX(price)
  INTO min_90d, max_90d
  FROM price_snapshots
  WHERE resource = resource_name
    AND created_at >= NOW() - '90 days'::INTERVAL;
  
  RETURN QUERY SELECT
    resource_name,
    COALESCE(current_val, 0)::NUMERIC,
    COALESCE(avg_val, 0)::NUMERIC,
    COALESCE(min_val, 0)::NUMERIC,
    COALESCE(max_val, 0)::NUMERIC,
    CASE WHEN avg_val > 0 THEN ((current_val - avg_val) / avg_val * 100)::NUMERIC ELSE 0 END,
    count_val,
    current_val <= COALESCE(min_90d, current_val),
    current_val >= COALESCE(max_90d, current_val);
END;
$$;

-- 3. Grant execute permission to service role (for Supabase service_role key)
GRANT EXECUTE ON FUNCTION get_price_stats TO service_role;

-- 4. Verify the setup
SELECT 'Database setup complete!' AS status;