-- Creates user_feedback table for storing user feedback/bug reports
CREATE TABLE IF NOT EXISTS user_feedback (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  message TEXT NOT NULL,
  category TEXT CHECK (category IN ('bug', 'suggestion', 'other')) DEFAULT 'other',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_user_feedback_created_at ON user_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_feedback_user_id ON user_feedback(user_id);