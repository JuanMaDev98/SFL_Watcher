-- Prevent the same wallet from being linked to multiple Telegram accounts
-- First clean any existing duplicates (keep the newest connection)
DELETE FROM user_wallets a USING (
  SELECT MIN(id) as id, wallet_address
  FROM user_wallets
  GROUP BY wallet_address
  HAVING COUNT(*) > 1
) b
WHERE a.wallet_address = b.wallet_address AND a.id != b.id;

-- Add unique constraint on wallet_address
ALTER TABLE user_wallets ADD CONSTRAINT unique_wallet_address UNIQUE (wallet_address);
