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
  const { title = 'SFL Watcher', tags = '', priority = 4 } = options;

  try {
    const response = await fetch(`${NTFY_BASE}/${topic}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Title': title,
        'Tags': tags,
        'Priority': priority.toString(),
        'X-Tags': tags
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
 * Format price alert for NTFY
 */
function formatNtfyAlert(resource, currentPct, stats, thresholdHigh, thresholdLow) {
  const isAbove = currentPct > 0;
  const emoji = isAbove ? '🔺' : '🔻';
  const direction = isAbove ? '🔼 UP' : '🔽 DOWN';
  const sign = currentPct > 0 ? '+' : '';

  const lines = [
    `${emoji} ${resource.toUpperCase()} Alert`,
    `${direction} ${sign}${currentPct}% vs avg`,
    `Price: ${stats.current_price?.toFixed(4)} | Avg: ${stats.avg_price?.toFixed(4)}`,
    `Thresholds: ▲ +${thresholdHigh}% | ▼ ${thresholdLow}%`
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
    'Want to use a private topic?',
    `/ntfyprivate to generate a password-protected topic`
  ].join('\n');
}

module.exports = { sendNtfyNotification, formatNtfyAlert, getUserNtfyTopic, getNtfyInstructions };
