import { Canvas, loadImage } from 'skia-canvas';
import { readJSON } from '../storage/hfClient.js'; // Imported to retain architecture integrity
import path from 'path';

const defaultBackgrounds = new Map();
const customCache = new Map();
const DEFAULT_BG_KEYS = ['default1', 'default2', 'default3'];

// Pre-load 3 default backgrounds on module startup
await Promise.all(DEFAULT_BG_KEYS.map(async (key) => {
  try {
    const imgPath = path.resolve(process.cwd(), `src/assets/backgrounds/${key}.png`);
    const img = await loadImage(imgPath);
    defaultBackgrounds.set(key, img);
  } catch (err) {
    console.warn(`[canvas/leaveCard] Failed to preload default background '${key}': ${err.message}`);
  }
}));

export async function generateLeaveCard({ avatarURL, username, serverName, memberCount, config, guildId }) {
  const { leaveBackground, cardTextColor } = config || {};
  const accentColor = '#ed4245'; // Hardcoded requirement for leave operations
  let bg = defaultBackgrounds.get('default1');

  if (config && DEFAULT_BG_KEYS.includes(leaveBackground)) {
    bg = defaultBackgrounds.get(leaveBackground) || defaultBackgrounds.get('default1');
  } else if (leaveBackground === 'custom' && guildId) {
    if (!customCache.has(guildId)) {
      try {
        const bucketName = process.env.HF_BUCKET_NAME;
        const HF_TOKEN = process.env.HF_TOKEN;
        const directUrl = `https://huggingface.co/buckets/${bucketName}/resolve/guilds/${guildId}/background-leave.png`;
        
        let res = await fetch(directUrl, {
          method: 'GET',
          headers: HF_TOKEN ? { 'Authorization': `Bearer ${HF_TOKEN}` } : {},
          redirect: 'manual'
        });

        if (res.status === 302 || res.status === 307) {
          const s3Url = res.headers.get('location');
          if (s3Url) {
            res = await fetch(s3Url, { method: 'GET' });
          }
        }

        if (res.ok) {
          const buffer = await res.arrayBuffer();
          const img = await loadImage(Buffer.from(buffer));
          customCache.set(guildId, img);
          bg = img;
        } else {
          throw new Error(`Bucket returned status ${res.status}`);
        }
      } catch (err) {
        console.warn(`[canvas/leaveCard] Custom background fetch failed, falling back to default1: ${err.message}`);
      }
    } else {
      bg = customCache.get(guildId);
    }
  }

  const canvas = new Canvas(800, 200);
  const ctx = canvas.getContext('2d');

  // 1. Background image scaled to fill full 800x200
  ctx.drawImage(bg, 0, 0, 800, 200);

  // 2. Dark overlay rgba(0,0,0,0.55) fillRect full canvas
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, 800, 200);

  // 3. Accent bar
  ctx.fillStyle = accentColor;
  ctx.fillRect(0, 0, 6, 200);

  // 4. Avatar circle
  try {
    const avatar = await loadImage(avatarURL);
    ctx.save();
    ctx.beginPath();
    ctx.arc(110, 100, 70, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, 40, 30, 140, 140);
    ctx.restore();
  } catch (avatarErr) {
    console.warn(`[canvas/leaveCard] Failed loading avatar, drawing empty circle wrapper: ${avatarErr.message}`);
  }

  ctx.beginPath();
  ctx.arc(110, 100, 70, 0, Math.PI * 2);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 4;
  ctx.stroke();

  // 5. Server name
  ctx.font = 'bold 15px DejaVu Sans';
  ctx.fillStyle = accentColor;
  ctx.fillText((serverName || 'SERVER').toUpperCase(), 200, 70);

  // 6. Username
  ctx.font = 'bold 32px DejaVu Sans';
  ctx.fillStyle = cardTextColor || '#ffffff';
  ctx.fillText(username || 'UnknownUser', 200, 115);

  // 7. Member count
  ctx.font = '16px DejaVu Sans';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(`We now have ${memberCount || 0} members`, 200, 148);

  return canvas.toBuffer('png');
}
