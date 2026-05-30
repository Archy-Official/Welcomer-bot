import { Canvas, loadImage } from 'skia-canvas';
import { readJSON } from '../storage/hfClient.js';
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
    console.warn(`[canvas/welcomeCard] Failed to preload default background '${key}': ${err.message}`);
  }
}));

export async function generateWelcomeCard({ avatarURL, username, serverName, memberCount, config }) {
  const { welcomeBackground, cardTextColor, cardAccentColor, guildId } = config || {};
  let bg = defaultBackgrounds.get('default1'); // Fallback default map variable

  if (config && DEFAULT_BG_KEYS.includes(welcomeBackground)) {
    bg = defaultBackgrounds.get(welcomeBackground);
  } else if (welcomeBackground === 'custom' && guildId) {
    if (!customCache.has(guildId)) {
      try {
        const bucketName = process.env.HF_BUCKET_NAME;
        const HF_TOKEN = process.env.HF_TOKEN;
        const directUrl = `https://huggingface.co/buckets/${bucketName}/resolve/guilds/${guildId}/background-welcome.png`;
        
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
        console.warn(`[canvas/welcomeCard] Custom background fetch failed: ${err.message}`);
      }
    } else {
      bg = customCache.get(guildId);
    }
  }

  const canvas = new Canvas(800, 200);
  const ctx = canvas.getContext('2d');

  // 1. Background image layer with automated safety switch
  if (bg) {
    ctx.drawImage(bg, 0, 0, 800, 200);
  } else {
    // If local asset files are missing, paint a sleek premium charcoal background instead of crashing
    ctx.fillStyle = '#1e1f22'; 
    ctx.fillRect(0, 0, 800, 200);
  }

  // 2. Dark overlay rgba(0,0,0,0.45) fillRect full canvas
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, 800, 200);

  // 3. Accent bar
  ctx.fillStyle = cardAccentColor || '#5865F2';
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
    console.warn(`[canvas/welcomeCard] Failed loading avatar, drawing empty backup circle: ${avatarErr.message}`);
  }

  ctx.beginPath();
  ctx.arc(110, 100, 70, 0, Math.PI * 2);
  ctx.strokeStyle = cardAccentColor || '#5865F2';
  ctx.lineWidth = 4;
  ctx.stroke();

  // 5. Server name
  ctx.font = 'bold 15px DejaVu Sans';
  ctx.fillStyle = cardAccentColor || '#5865F2';
  ctx.fillText((serverName || 'SERVER').toUpperCase(), 200, 70);

  // 6. Username
  ctx.font = 'bold 32px DejaVu Sans';
  ctx.fillStyle = cardTextColor || '#ffffff';
  ctx.fillText(username || 'UnknownUser', 200, 115);

  // 7. Member count
  ctx.font = '16px DejaVu Sans';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(`Member #${memberCount || 0}`, 200, 148);

  return canvas.toBuffer('png');
}
