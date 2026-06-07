import { Canvas, loadImage } from 'skia-canvas';
import { readBinary } from '../storage/hfClient.js';
import path from 'path';

const defaultBgMap  = new Map();
const customBgCache = new Map();
const DEFAULT_BG_KEYS = ['default1', 'default2', 'default3'];

await Promise.all(DEFAULT_BG_KEYS.map(async (key) => {
  try {
    const img = await loadImage(path.resolve(process.cwd(), `src/assets/backgrounds/${key}.png`));
    defaultBgMap.set(key, img);
  } catch (err) {
    console.warn(`[leaveCard] Failed to preload background '${key}': ${err.message}`);
  }
}));

// Pass slotName to invalidate a specific slot, or omit to clear all for the guild
export function invalidateLeaveBgCache(guildId, slotName) {
  if (slotName) {
    customBgCache.delete(`${guildId}_leave_${slotName}`);
  } else {
    for (const key of customBgCache.keys()) {
      if (key.startsWith(`${guildId}_leave_`)) customBgCache.delete(key);
    }
  }
}

export async function generateLeaveCard({ avatarURL, username, serverName, memberCount, config, guildId }) {
  const { leaveBackground, cardTextColor } = config || {};
  const accentColor = '#ED4245';
  let bg = defaultBgMap.get('default1');

  if (config && DEFAULT_BG_KEYS.includes(leaveBackground)) {
    bg = defaultBgMap.get(leaveBackground);
  } else if (leaveBackground && guildId) {
    const cacheKey = `${guildId}_leave_${leaveBackground}`;

    if (customBgCache.has(cacheKey)) {
      bg = customBgCache.get(cacheKey);
    } else {
      try {
        const buffer = await readBinary(`guilds/${guildId}/assets/backgrounds/leave/${leaveBackground}.png`);
        if (buffer) {
          const img = await loadImage(buffer);
          customBgCache.set(cacheKey, img);
          bg = img;
        } else {
          bg = defaultBgMap.get('default1');
        }
      } catch (err) {
        console.warn(`[leaveCard] Custom background unavailable (${cacheKey}): ${err.message}`);
        bg = defaultBgMap.get('default1');
      }
    }
  }

  const canvas = new Canvas(800, 200);
  const ctx    = canvas.getContext('2d');

  if (bg) {
    ctx.drawImage(bg, 0, 0, 800, 200);
  } else {
    ctx.fillStyle = '#1e1f22';
    ctx.fillRect(0, 0, 800, 200);
  }

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, 800, 200);

  ctx.fillStyle = accentColor;
  ctx.fillRect(0, 0, 6, 200);

  try {
    const avatar = await loadImage(avatarURL);
    ctx.save();
    ctx.beginPath();
    ctx.arc(110, 100, 70, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, 40, 30, 140, 140);
    ctx.restore();
  } catch (err) {
    console.warn(`[leaveCard] Avatar load failed: ${err.message}`);
  }

  ctx.beginPath();
  ctx.arc(110, 100, 70, 0, Math.PI * 2);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth   = 4;
  ctx.stroke();

  ctx.font      = 'bold 15px DejaVu Sans';
  ctx.fillStyle = accentColor;
  ctx.fillText((serverName || 'SERVER').toUpperCase(), 200, 70);

  ctx.font      = 'bold 32px DejaVu Sans';
  ctx.fillStyle = cardTextColor || '#ffffff';
  ctx.fillText(username || 'UnknownUser', 200, 115);

  ctx.font      = '16px DejaVu Sans';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(`We now have ${memberCount || 0} members`, 200, 148);

  return canvas.toBuffer('png');
}