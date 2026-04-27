-- Fix: Alter price_snapshots to support higher values
ALTER TABLE price_snapshots 
ALTER COLUMN price TYPE NUMERIC(30, 20);

-- Verify the change
SELECT column_name, data_type, numeric_precision, numeric_scale 
FROM information_schema.columns 
WHERE table_name = 'price_snapshots' AND column_name = 'price';