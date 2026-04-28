-- Add NTFY settings to user_subscriptions table
ALTER TABLE user_subscriptions 
ADD COLUMN IF NOT EXISTS ntfy_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ntfy_graph_enabled BOOLEAN DEFAULT true;
