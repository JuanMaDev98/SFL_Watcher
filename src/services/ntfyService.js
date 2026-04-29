/**
 * NTFY Service - Push notifications to phone via NTFY app
 * https://ntfy.sh
 */

const NTFY_BASE = 'https://ntfy.sh';

/**
 * Send notification via NTFY
 * @param {string} topic - Unique topic name (e.g., sfl-123456)
 * @param {string} message - Notification message
 * @param {object} options - Optional settings
 */
async function sendNtfyNotification(topic, message, options = {}) {
  const { 
    title = 'SFL Watcher', 
    tags = '', 
    priority = 4
  } = options;

  try {
    const response = await fetch(`${NTFY_BASE}/${topic}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Title': title,
        'Tags': tags,
        'Priority': priority.toString()
      },
      body: message
    });

    if (!response.ok) {
      console.error(`[NTFY] Error: ${response.status} ${response.statusText}`);
      return false;
    }

    console.log(`[NTFY] Notification sent to ${topic}`);
    return true;
  } catch (error) {
    console.error('[NTFY] Send error:', error.message);
    return false;
  }
}

/**
 * Send notification with image attachment via NTFY
 * Note: NTFY attachments work best with URLs or small files
 * For base64 images in Vercel, we upload to a temp service
 */
async function sendNtfyNotificationWithImage(topic, message, imageDataUrl, options = {}) {
  const { title = 'SFL Watcher', tags = 'chart', priority = 4 } = options;

  try {
    // For Vercel/serverless, we'll use a workaround:
    // Convert base64 to blob and send as multipart
    const matches = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      // Not a valid data URL, send text only
      return sendNtfyNotification(topic, message, { title, tags, priority });
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');
    
    const blob = new Blob([buffer], { type: mimeType });

    const formData = new FormData();
    formData.append('file', blob, 'chart.png');
    formData.append('message', message);

    const response = await fetch(`${NTFY_BASE}/${topic}`, {
      method: 'POST',
      headers: {
        'Title': title,
        'Tags': tags,
        'Priority': priority.toString()
      },
      body: formData
    });

    if (!response.ok) {
      console.error(`[NTFY] Error with image: ${response.status}`);
      // Fallback to text-only
      return sendNtfyNotification(topic, message, { title, tags, priority });
    }

    console.log(`[NTFY] Notification with image sent to ${topic}`);
    return true;
  } catch (error) {
    console.error('[NTFY] Send with image error:', error.message);
    // Fallback to text-only
    return sendNtfyNotification(topic, message, { title, tags, priority });
  }
}

/**
 * Format price alert for NTFY (ASCII-safe, no emojis)
 */
function formatNtfyAlert(resource, currentPct, stats, thresholdHigh, thresholdLow) {
  const isAbove = currentPct > 0;
  const direction = isAbove ? 'UP' : 'DOWN';
  const sign = currentPct > 0 ? '+' : '';

  const lines = [
    `[ALERT] ${resource.toUpperCase()}`,
    `${direction} ${sign}${currentPct}% vs avg`,
    `Price: ${stats.current_price?.toFixed(4)} | Avg: ${stats.avg_price?.toFixed(4)}`,
    `Thresholds: +${thresholdHigh}% / ${thresholdLow}%`
  ];

  return lines.join('\n');
}

/**
 * Get NTFY topic for a user
 * Format: sfl-{userId}
 */
function getUserNtfyTopic(userId) {
  return `sfl-${userId}`;
}

/**
 * Generate setup instructions for user
 */
function getNtfyInstructions(topic) {
  return [
    '📱 <b>NTFY Setup</b>',
    '',
    `Your topic: <code>${topic}</code>`,
    '',
    '1. Open NTFY app',
    `2. Tap "Subscribe" and enter: <code>${topic}</code>`,
    '3. Done! You\'ll receive alerts as phone notifications.',
    '',
    '🔔 <b>Commands:</b>',
    '/ntfy - Show setup info',
    '/ntfytest - Send test notification',
    '/ntfygraph - Toggle graph attachments',
    '/ntfystatus - Check your NTFY settings'
  ].join('\n');
}

module.exports = { 
  sendNtfyNotification, 
  sendNtfyNotificationWithImage,
  formatNtfyAlert, 
  getUserNtfyTopic, 
  getNtfyInstructions 
};
