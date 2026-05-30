import { verifyKey } from 'https://esm.sh/discord-interactions';

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

    const isValidRequest = verifyKey(
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
