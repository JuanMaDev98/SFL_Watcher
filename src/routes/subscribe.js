const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const logger = require('../utils/logger');

// POST /api/subscribe - Save FCM token
router.post('/', async (req, res) => {
  try {
    const { user_id, token, device } = req.body;

    if (!user_id || !token) {
      return res.status(400).json({
        success: false,
        error: 'user_id and token are required'
      });
    }

    // Upsert: update if exists, insert if not
    const { data, error } = await supabase
      .from('fcm_tokens')
      .upsert({
        user_id,
        token,
        device: device || null,
        created_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,token'
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, data });
  } catch (error) {
    logger.error('POST /api/subscribe error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/subscribe - Remove FCM token
router.delete('/', async (req, res) => {
  try {
    const { user_id, token } = req.body;

    if (!user_id || !token) {
      return res.status(400).json({
        success: false,
        error: 'user_id and token are required'
      });
    }

    const { error } = await supabase
      .from('fcm_tokens')
      .delete()
      .eq('user_id', user_id)
      .eq('token', token);

    if (error) throw error;

    res.json({ success: true, message: 'Token removed' });
  } catch (error) {
    logger.error('DELETE /api/subscribe error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
