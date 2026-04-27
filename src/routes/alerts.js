const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

/**
 * POST /api/alerts - Create or update alert with high/low thresholds
 * 
 * Body options:
 * 1. Simple (legacy): { user_id, resource, alert_type, threshold_percent }
 * 2. Dual threshold: { user_id, resource, threshold_high, threshold_low }
 *    - threshold_high: alert when price is X% ABOVE average (e.g. 10)
 *    - threshold_low: alert when price is X% BELOW average (e.g. -15)
 * 
 * alert_type can be: 'dual' (use both thresholds), 'threshold_above' (high only), 'threshold_below' (low only)
 */
router.post('/', async (req, res) => {
  try {
    const { user_id, resource, threshold_high, threshold_low, alert_type } = req.body;

    if (!user_id || !resource) {
      return res.status(400).json({
        success: false,
        error: 'user_id and resource are required'
      });
    }

    // Validate thresholds
    if (threshold_high !== undefined && isNaN(parseFloat(threshold_high))) {
      return res.status(400).json({ success: false, error: 'threshold_high must be a number' });
    }
    if (threshold_low !== undefined && isNaN(parseFloat(threshold_low))) {
      return res.status(400).json({ success: false, error: 'threshold_low must be a number' });
    }

    // Check if alert already exists for this user+resource
    const { data: existing } = await supabase
      .from('user_alerts')
      .select('*')
      .eq('user_id', user_id)
      .eq('resource', resource.toLowerCase())
      .eq('enabled', true)
      .single();

    const now = new Date().toISOString();

    if (existing) {
      // Update existing alert
      const { data, error } = await supabase
        .from('user_alerts')
        .update({
          threshold_high: threshold_high !== undefined ? parseFloat(threshold_high) : existing.threshold_high,
          threshold_low: threshold_low !== undefined ? parseFloat(threshold_low) : existing.threshold_low,
          alert_type: alert_type || 'dual',
          updated_at: now
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      return res.json({ success: true, data, updated: true });
    } else {
      // Create new alert
      const { data, error } = await supabase
        .from('user_alerts')
        .insert({
          user_id,
          resource: resource.toLowerCase(),
          alert_type: alert_type || 'dual',
          threshold_high: threshold_high !== undefined ? parseFloat(threshold_high) : 10,
          threshold_low: threshold_low !== undefined ? parseFloat(threshold_low) : -10,
          enabled: true,
          created_at: now
        })
        .select()
        .single();

      if (error) throw error;
      res.status(201).json({ success: true, data, updated: false });
    }

  } catch (error) {
    console.error('POST /api/alerts error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/alerts - Get alerts for user
 */
router.get('/', async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ success: false, error: 'user_id is required' });
    }

    const { data, error } = await supabase
      .from('user_alerts')
      .select('*')
      .eq('user_id', user_id)
      .eq('enabled', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data });

  } catch (error) {
    console.error('GET /api/alerts error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/alerts/:id - Delete (disable) alert
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query; // require user_id to prevent accidental deletes

    if (!user_id) {
      return res.status(400).json({ success: false, error: 'user_id is required' });
    }

    const { error } = await supabase
      .from('user_alerts')
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user_id);

    if (error) throw error;
    res.json({ success: true, message: 'Alert disabled' });

  } catch (error) {
    console.error('DELETE /api/alerts/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;