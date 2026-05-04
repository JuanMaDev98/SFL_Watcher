CREATE TABLE IF NOT EXISTS critical_alert_states (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  current_step INTEGER NOT NULL DEFAULT 0,
  last_percent NUMERIC,
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, resource, direction)
);

CREATE INDEX IF NOT EXISTS idx_critical_alert_states_lookup
  ON critical_alert_states (resource, user_id, direction);
