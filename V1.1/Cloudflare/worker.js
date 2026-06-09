/**
 * Verifies Discord Ed25519 signature (Cloudflare Workers safe)
 */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function verifyDiscordSignature(rawBody, signature, timestamp, publicKeyHex) {
  if (!signature || !timestamp || !publicKeyHex) return false;

  try {
    const enc = new TextEncoder();

    const t = enc.encode(timestamp);
    const b = enc.encode(rawBody);

    const message = new Uint8Array(t.length + b.length);
    message.set(t);
    message.set(b, t.length);

    const sigBytes = hexToBytes(signature);
    const pubKeyBytes = hexToBytes(publicKeyHex);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      pubKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify']
    );

    return await crypto.subtle.verify(
      'Ed25519',
      cryptoKey,
      sigBytes,
      message
    );
  } catch (err) {
    console.error('[Auth] Signature verification failed:', err);
    return false;
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const signature = request.headers.get('x-signature-ed25519');
    const timestamp = request.headers.get('x-signature-timestamp');

    if (!signature || !timestamp) {
      return new Response('Missing signature headers', { status: 400 });
    }

    const rawBody = await request.text();

    const verified = await verifyDiscordSignature(
      rawBody,
      signature,
      timestamp,
      env.DISCORD_PUBLIC_KEY
    );

    if (!verified) {
      return new Response('Unauthorized', { status: 401 });
    }

    const interaction = JSON.parse(rawBody);

    if (interaction.type === 1) {
      return Response.json({ type: 1 });
    }

    if (interaction.type === 2) {
      ctx.waitUntil(
        fetch(`${env.HF_SERVICES_URL}/interactions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-secret': env.API_SECRET,
          },
          body: rawBody,
        }).catch(err =>
          console.error('[Forward] HF services unreachable:', err)
        )
      );

      return Response.json({
        type: 5,
        data: { flags: 64 },
      });
    }

    return new Response('OK', { status: 200 });
  },
};