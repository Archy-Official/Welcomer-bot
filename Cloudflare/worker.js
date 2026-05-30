// Native implementation of Discord's Ed25519 signature verification.
// This completely removes the need for external packages or URL imports!
async function verifyDiscordSignature(rawBody, signature, timestamp, publicKeyHex) {
  try {
    if (!signature || !timestamp || !publicKeyHex) return false;

    const encoder = new TextEncoder();
    const timestampData = encoder.encode(timestamp);
    const bodyData = encoder.encode(rawBody);

    // Concatenate timestamp and body bytes
    const message = new Uint8Array(timestampData.length + bodyData.length);
    message.set(timestampData);
    message.set(bodyData, timestampData.length);

    // Convert hex strings to Uint8Array bytes
    const hexToUint8Array = (hexString) => {
      const pairs = hexString.match(/.{1,2}/g);
      if (!pairs) return new Uint8Array();
      return new Uint8Array(pairs.map(byte => parseInt(byte, 16)));
    };

    const signatureArray = hexToUint8Array(signature);
    const publicKeyArray = hexToUint8Array(publicKeyHex);

    // Import public key into Cloudflare's native Crypto engine
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      publicKeyArray,
      { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' },
      false,
      ['verify']
    );

    // Natively verify the signature
    return await crypto.subtle.verify(
      'NODE-ED25519',
      cryptoKey,
      signatureArray,
      message
    );
  } catch (err) {
    console.error('Crypto Verification Error:', err);
    return false;
  }
}

export default {
  async fetch(request, env, ctx) {
    // Reject non-POST requests
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const signature = request.headers.get('x-signature-ed25519');
    const timestamp = request.headers.get('x-signature-timestamp');

    if (!signature || !timestamp) {
      return new Response('Missing Discord signature headers', { status: 400 });
    }

    // Consume body as text for cryptographic verification
    const rawBody = await request.text();

    // Call our native verification function
    const isValidRequest = await verifyDiscordSignature(
      rawBody,
      signature,
      timestamp,
      env.DISCORD_PUBLIC_KEY
    );

    if (!isValidRequest) {
      return new Response('Invalid signature', { status: 401 });
    }

    const interaction = JSON.parse(rawBody);

    // Handle Discord PING verification
    if (interaction.type === 1) {
      return Response.json({ type: 1 });
    }

    // Handle Application Commands
    if (interaction.type === 2) {
      // Immediately respond with deferred ephemeral message to avoid Discord timeout
      const deferredResponse = Response.json({
        type: 5,
        data: { flags: 64 } // 64 = EPHEMERAL
      });

      // Fire-and-forget forward to Hugging Face services
      ctx.waitUntil(
        fetch(`${env.HF_SERVICES_URL}/interactions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-secret': env.API_SECRET
          },
          body: rawBody
        }).catch(err => {
          console.error('Failed to forward interaction to HF services:', err);
        })
      );

      return deferredResponse;
    }

    // Fallback for unhandled interaction types
    return new Response('Unhandled interaction type', { status: 200 });
  }
};
