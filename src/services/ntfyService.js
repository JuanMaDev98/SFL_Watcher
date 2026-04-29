/**
 * NTFY Service - Push notifications to phone via NTFY app
 * https://ntfy.sh
 * 
 * Note: NTFY uses HTTP headers, and Vercel Edge runtime can't handle
 * non-ASCII characters (like emojis) in header values. Use ASCII only.
 */

const NTFY_BASE = 'https://ntfy.sh';
const TMPFILES_BASE = 'https://tmpfiles.org';

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

  console.log(`[NTFY] === SEND NOTIFICATION ===`);
  console.log(`[NTFY] Topic: ${topic}`);
  console.log(`[NTFY] Title (ASCII): ${asciiTitle}`);
  console.log(`[NTFY] Tags: ${asciiTags}`);
  console.log(`[NTFY] Priority: ${priority}`);
  console.log(`[NTFY] Message length: ${message?.length || 0}`);
  console.log(`[NTFY] Message preview: ${message?.substring(0, 100)}...`);

  try {
    const url = `${NTFY_BASE}/${topic}`;
    console.log(`[NTFY] Request URL: ${url}`);
    
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

    console.log(`[NTFY] Response status: ${response.status} ${response.statusText}`);
    console.log(`[NTFY] Response ok: ${response.ok}`);
    
    // Read response body for more details
    const responseText = await response.text().catch(() => 'Could not read response');
    console.log(`[NTFY] Response body: ${responseText.substring(0, 200)}`);

    if (!response.ok) {
      console.error(`[NTFY] Error: ${response.status} ${response.statusText}`);
      console.error(`[NTFY] Full response:`, responseText);
      return false;
    }

    console.log(`[NTFY] Notification sent successfully to ${topic}`);
    return true;
  } catch (error) {
    console.error(`[NTFY] Send error: ${error.message}`);
    console.error(`[NTFY] Error stack:`, error.stack);
    return false;
  }
}

/**
 * Upload file to tmpfiles.org and return URL
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Filename
 * @returns {Promise<string|null>} - URL to file or null if failed
 */
async function uploadToTmpfiles(buffer, filename) {
  try {
    console.log(`[TMPFILES] Uploading ${filename} (${buffer.length} bytes)...`);
    
    const formData = new FormData();
    formData.append('file', new Blob([buffer]), filename);

    const response = await fetch(`${TMPFILES_BASE}/api/v1/upload`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      console.error(`[TMPFILES] Upload failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log(`[TMPFILES] Response:`, JSON.stringify(data));

    // tmpfiles.org returns { status: "success", url: "https://tmpfiles.org/xxx/filename.png" }
    if (data.status === 'success' && data.url) {
      // Convert to direct download URL (tmpfiles.org/xxx/file.png -> tmpfiles.org/dl/xxx/file.png)
      const directUrl = data.url.replace('/file/', '/dl/');
      console.log(`[TMPFILES] Direct URL: ${directUrl}`);
      return directUrl;
    }

    console.error(`[TMPFILES] Unexpected response:`, data);
    return null;
  } catch (error) {
    console.error(`[TMPFILES] Upload error: ${error.message}`);
    return null;
  }
}

/**
 * Send notification with image attachment via NTFY
 * 
 * Strategy: Upload image to tmpfiles.org, then send NTFY message with the image URL.
 * This makes the image appear as a clickable link that opens in browser.
 * 
 * Note: NTFY can't inline-render base64 images directly in notifications.
 * Using tmpfiles.org URL approach provides a working solution.
 */
async function sendNtfyNotificationWithImage(topic, message, imageDataUrl, options = {}) {
  const { title = 'SFL Watcher', tags = 'chart', priority = 4 } = options;

  // Vercel Edge can't handle non-ASCII in headers - strip any non-ASCII chars
  const asciiTitle = title.replace(/[^\x00-\x7F]/g, '');
  const asciiTags = tags.replace(/[^\x00-\x7F]/g, '');

  console.log(`[NTFY-IMG] === SEND NOTIFICATION WITH IMAGE ===`);
  console.log(`[NTFY-IMG] Topic: ${topic}`);
  console.log(`[NTFY-IMG] Title (ASCII): ${asciiTitle}`);
  console.log(`[NTFY-IMG] Image data URL length: ${imageDataUrl?.length || 0}`);

  try {
    // Parse base64 data URL
    const matches = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      console.log(`[NTFY-IMG] Invalid data URL format, falling back to text-only`);
      return sendNtfyNotification(topic, message, { title: asciiTitle, tags: asciiTags, priority });
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');
    
    console.log(`[NTFY-IMG] MimeType: ${mimeType}, Buffer size: ${buffer.length} bytes`);

    // Upload to tmpfiles.org
    const imageUrl = await uploadToTmpfiles(buffer, 'chart.png');
    
    if (!imageUrl) {
      console.log(`[NTFY-IMG] Failed to upload image, falling back to text-only`);
      return sendNtfyNotification(topic, message, { title: asciiTitle, tags: asciiTags, priority });
    }

    // Send NTFY with message containing the image URL
    const messageWithImage = `${message}\n\nChart: ${imageUrl}`;
    console.log(`[NTFY-IMG] Message with URL: ${messageWithImage.substring(0, 100)}...`);

    return sendNtfyNotification(topic, messageWithImage, { title: asciiTitle, tags: asciiTags, priority });
  } catch (error) {
    console.error(`[NTFY-IMG] Send with image error: ${error.message}`);
    console.error(`[NTFY-IMG] Error stack:`, error.stack);
    // Fallback to text-only
    console.log(`[NTFY-IMG] Falling back to text-only notification`);
    return sendNtfyNotification(topic, message, { title: asciiTitle, tags: asciiTags, priority });
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
