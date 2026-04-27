const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// POST /api/alerts - Create alert
router.post('/', async (req, res) => {
  try {
    const { user_id, resource, alert_type, threshold_percent } = req.body;

    if (!user_id || !resource || !alert_type) {
      return res.status(400).json({ 
        success: false, 
        error: 'user_id, resource, and alert_type are required' 
      });
    }

    const validTypes = ['spike', 'threshold_above', 'threshold_below', 'seasonal'];
    if (!validTypes.includes(alert_type)) {
      return res.status(400).json({
        success: false,
        error: `alert_type must be one of: ${validTypes.join(', ')}`
      });
    }

    const { data, error } = await supabase
      .from('user_alerts')
      .insert({
        user_id,
        resource: resource.toLowerCase(),
        alert_type,
        threshold_percent: threshold_percent || null,
        enabled: true
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, data });
  } catch (error) {
    console.error('POST /api/alerts error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/alerts - Get alerts for user
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

// DELETE /api/alerts/:id - Delete alert
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('user_alerts')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ success: true, message: 'Alert deleted' });
  } catch (error) {
    console.error('DELETE /api/alerts/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;