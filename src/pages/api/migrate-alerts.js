/**
 * Temporary migration endpoint - run once then delete
 * Executes: ALTER TABLE user_alerts to add threshold_high, threshold_low, last_notified_at columns
 */
const supabase = require('../lib/supabase');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Run the migration SQL
    // Using supabase.rpc with a function that runs DDL
    // First, try creating the function and calling it
    const { error } = await supabase.rpc('exec_migration', {
      sql: `
        ALTER TABLE user_alerts 
        ADD COLUMN IF NOT EXISTS threshold_high NUMERIC DEFAULT 10,
        ADD COLUMN IF NOT EXISTS threshold_low NUMERIC DEFAULT -10,
        ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
        
        ALTER TABLE user_alerts ALTER COLUMN threshold_percent DROP NOT NULL;
      `
    });

    if (error) {
      // Try alternative approach
      console.log('RPC approach failed, trying direct insert approach...');
      return res.status(500).json({ 
        error: error.message,
        hint: 'Run this SQL manually in Supabase dashboard SQL Editor: ALTER TABLE user_alerts ADD COLUMN threshold_high NUMERIC DEFAULT 10, ADD COLUMN threshold_low NUMERIC DEFAULT -10, ADD COLUMN last_notified_at TIMESTAMPTZ, ADD COLUMN updated_at TIMESTAMPTZ; ALTER TABLE user_alerts ALTER COLUMN threshold_percent DROP NOT NULL;'
      });
    }

    return res.json({ success: true, message: 'Migration complete' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};