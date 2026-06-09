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
    console.warn(`[welcomeCard] Failed to preload background '${key}': ${err.message}`);
  }
}));

export function invalidateWelcomeBgCache(guildId, slotName) {
  if (slotName) {
    customBgCache.delete(`${guildId}_welcome_${slotName}`);
  } else {
    for (const key of customBgCache.keys()) {
      if (key.startsWith(`${guildId}_welcome_`)) customBgCache.delete(key);
    }
  }
}

export async function generateWelcomeCard({ avatarURL, username, serverName, memberCount, config, guildId }) {
  const { welcomeBackground, cardTextColor } = config || {};
  const accentColor = '#5865F2';
  let bg = defaultBgMap.get('default1');

  if (welcomeBackground && DEFAULT_BG_KEYS.includes(welcomeBackground)) {
    bg = defaultBgMap.get(welcomeBackground);
  } else if (welcomeBackground) {
    const cacheKey = `${guildId}_welcome_${welcomeBackground}`;
    if (customBgCache.has(cacheKey)) {
      bg = customBgCache.get(cacheKey);
    } else {
      try {
        // Look in unified shared directory
        const buffer = await readBinary(`guilds/${guildId}/assets/backgrounds/shared/${welcomeBackground}.png`);
        if (buffer) {
          bg = await loadImage(buffer);
          customBgCache.set(cacheKey, bg);
        }
      } catch (err) {
        console.warn(`[welcomeCard] Custom background unavailable (${cacheKey}): ${err.message}`);
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
    console.warn(`[welcomeCard] Avatar load failed: ${err.message}`);
  }

  ctx.fillStyle = cardTextColor || '#ffffff';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText('WELCOME', 210, 75);

  ctx.font = '26px sans-serif';
  ctx.fillText(username, 210, 115);

  ctx.fillStyle = '#b5bac1';
  ctx.font = '18px sans-serif';
  ctx.fillText(`Member #${memberCount}`, 210, 155);

  return canvas.toBuffer('png');
}