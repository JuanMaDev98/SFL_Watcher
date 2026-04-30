/**
 * NTFY Service - Push notifications to phone via NTFY app
 * https://ntfy.sh
 * 
 * Note: NTFY uses HTTP headers, and Vercel Edge runtime can't handle
 * non-ASCII characters (like emojis) in header values. Use ASCII only.
 */

const NTFY_BASE = 'https://ntfy.sh';
const CATBOX_BASE = 'https://catbox.fyi';

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

  // Vercel Edge can't handle non-ASCII in headers - strip any non-ASCII chars
  const asciiTitle = title.replace(/[^\x00-\x7F]/g, '');
  const asciiTags = tags.replace(/[^\x00-\x7F]/g, '');

  logger.info(`[NTFY] === SEND NOTIFICATION ===`);
  logger.info(`[NTFY] Topic: ${topic}`);
  logger.info(`[NTFY] Title (ASCII): ${asciiTitle}`);
  logger.info(`[NTFY] Tags: ${asciiTags}`);
  logger.info(`[NTFY] Priority: ${priority}`);
  logger.info(`[NTFY] Message length: ${message?.length || 0}`);
  logger.info(`[NTFY] Message preview: ${message?.substring(0, 100)}...`);

  try {
    const url = `${NTFY_BASE}/${topic}`;
    logger.info(`[NTFY] Request URL: ${url}`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Title': asciiTitle,
        'Tags': asciiTags,
        'Priority': priority.toString()
      },
      body: message
    });

    logger.info(`[NTFY] Response status: ${response.status} ${response.statusText}`);
    logger.info(`[NTFY] Response ok: ${response.ok}`);
    
    // Read response body for more details
    const responseText = await response.text().catch(() => 'Could not read response');
    logger.info(`[NTFY] Response body: ${responseText.substring(0, 200)}`);

    if (!response.ok) {
      logger.error(`[NTFY] Error: ${response.status} ${response.statusText}`);
      logger.error(`[NTFY] Full response:`, responseText);
      return false;
    }

    logger.info(`[NTFY] Notification sent successfully to ${topic}`);
    return true;
  } catch (error) {
    logger.error(`[NTFY] Send error: ${error.message}`);
    logger.error(`[NTFY] Error stack:`, error.stack);
    return false;
  }
}

/**
 * Upload file to catbox.fyi and return URL
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Filename
 * @returns {Promise<string|null>} - URL to file or null if failed
 */
async function uploadToCatbox(buffer, filename) {
  try {
    logger.info(`[CATBOX] Uploading ${filename} (${buffer.length} bytes)...`);
    
    const formData = new FormData();
    formData.append('reqtype', 'fileupload');
    formData.append('time', '12h'); // Keep for 12 hours
    formData.append('file', new Blob([buffer]), filename);

    const response = await fetch(CATBOX_BASE, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      logger.error(`[CATBOX] Upload failed: ${response.status}`);
      const errorText = await response.text().catch(() => 'unknown');
      logger.error(`[CATBOX] Error body: ${errorText}`);
      return null;
    }

    const url = await response.text();
    logger.info(`[CATBOX] Uploaded URL: ${url}`);
    
    // catbox returns just the URL as plain text
    if (url.startsWith('https://')) {
      return url.trim();
    }
    
    logger.error(`[CATBOX] Unexpected response: ${url}`);
    return null;
  } catch (error) {
    logger.error(`[CATBOX] Upload error: ${error.message}`);
    return null;
  }
}

/**
 * Send notification with image attachment via NTFY
 * 
 * Strategy: 
 * 1. Upload image to catbox.fyi (free, no auth needed)
 * 2. Send NTFY with Attach header pointing to the image URL
 * 3. NTFY displays the image inline in the notification
 */
async function sendNtfyNotificationWithImage(topic, message, imageDataUrl, options = {}) {
  const { title = 'SFL Watcher', tags = 'chart', priority = 4 } = options;

  // Vercel Edge can't handle non-ASCII in headers - strip any non-ASCII chars
  const asciiTitle = title.replace(/[^\x00-\x7F]/g, '');
  const asciiTags = tags.replace(/[^\x00-\x7F]/g, '');

  logger.info(`[NTFY-IMG] === SEND NOTIFICATION WITH IMAGE ===`);
  logger.info(`[NTFY-IMG] Topic: ${topic}`);
  logger.info(`[NTFY-IMG] Title (ASCII): ${asciiTitle}`);
  logger.info(`[NTFY-IMG] Image data URL length: ${imageDataUrl?.length || 0}`);

  try {
    // Parse base64 data URL
    const matches = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      logger.info(`[NTFY-IMG] Invalid data URL format, falling back to text-only`);
      return sendNtfyNotification(topic, message, { title: asciiTitle, tags: asciiTags, priority });
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');
    
    logger.info(`[NTFY-IMG] MimeType: ${mimeType}, Buffer size: ${buffer.length} bytes`);

    // Upload to catbox
    const imageUrl = await uploadToCatbox(buffer, 'chart.png');
    
    if (!imageUrl) {
      logger.info(`[NTFY-IMG] Failed to upload image, falling back to text-only`);
      return sendNtfyNotification(topic, message, { title: asciiTitle, tags: asciiTags, priority });
    }

    logger.info(`[NTFY-IMG] Image URL: ${imageUrl}`);

    // Send NTFY with Attach header
    return sendNtfyWithAttachment(topic, message, imageUrl, { 
      title: asciiTitle, 
      tags: asciiTags, 
      priority 
    });
  } catch (error) {
    logger.error(`[NTFY-IMG] Send with image error: ${error.message}`);
    logger.error(`[NTFY-IMG] Error stack:`, error.stack);
    // Fallback to text-only
    logger.info(`[NTFY-IMG] Falling back to text-only notification`);
    return sendNtfyNotification(topic, message, { title: asciiTitle, tags: asciiTags, priority });
  }
}

/**
 * Send NTFY notification with attachment via Attach header
 */
async function sendNtfyWithAttachment(topic, message, attachmentUrl, options = {}) {
  const { title = 'SFL Watcher', tags = '', priority = 4 } = options;

  logger.info(`[NTFY-ATTACH] === SEND WITH ATTACHMENT ===`);
  logger.info(`[NTFY-ATTACH] Topic: ${topic}`);
  logger.info(`[NTFY-ATTACH] Attachment URL: ${attachmentUrl}`);

  try {
    const url = `${NTFY_BASE}/${topic}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Title': title,
        'Tags': tags,
        'Priority': priority.toString(),
        'Attach': attachmentUrl
      },
      body: message
    });

    logger.info(`[NTFY-ATTACH] Response status: ${response.status} ${response.statusText}`);
    
    const responseText = await response.text().catch(() => 'Could not read response');
    logger.info(`[NTFY-ATTACH] Response body: ${responseText.substring(0, 200)}`);

    if (!response.ok) {
      logger.error(`[NTFY-ATTACH] Error: ${response.status} ${response.statusText}`);
      return false;
    }

    logger.info(`[NTFY-ATTACH] Notification with attachment sent successfully`);
    return true;
  } catch (error) {
    logger.error(`[NTFY-ATTACH] Send error: ${error.message}`);
    logger.error(`[NTFY-ATTACH] Error stack:`, error.stack);
    return false;
  }
}

/**
 * Format price alert for NTFY (simple message, no image)
 */
function formatNtfyAlert(resource, currentPct, stats, thresholdHigh, thresholdLow) {
  const isAbove = currentPct > 0;
  const arrow = isAbove ? '↑' : '↓';
  const sign = currentPct > 0 ? '+' : '';

  // 90-day min/max indicator
  let minMaxLabel = '';
  if (stats.is90DayMin) {
    minMaxLabel = ' [90D MIN]';
  } else if (stats.is90DayMax) {
    minMaxLabel = ' [90D MAX]';
  }

  // Color based on direction (green=up, red=down), 90D label adds context
  const colorLabel = isAbove ? '🟢' : '🔴';

  const avgStr = stats.avg_price?.toFixed(5) || stats.avg_price;
  const curStr = stats.current_price?.toFixed(5) || stats.current_price;

  const lines = [
    `${colorLabel} ${arrow} ${resource.toUpperCase()} ${sign}${currentPct}%${minMaxLabel}`,
    `💰 Price ${curStr} | 📊 Avg ${avgStr}`,
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
    'NTFY Setup',
    '',
    `Your topic: ${topic}`,
    '',
    '1. Open NTFY app',
    `2. Tap "Subscribe" and enter: ${topic}`,
    '3. Done! You will receive alerts as phone notifications.',
    '',
    'Commands:',
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
