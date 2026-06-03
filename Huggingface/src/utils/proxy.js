// src/utils/proxy.js

/**
 * Sends a patched webhook message back to Discord through the rotating proxy network.
 * Features a dynamic fallback loop that exhausts the pool before failing.
 */
export async function patchWebhook(clientId, token, payload, fileBuffer = null, fileName = null) {
  const discordRoute = `/v10/webhooks/${clientId}/${token}/messages/@original`;
  
  const rawPool = process.env.PROXY_POOL;
  if (!rawPool) {
    throw new Error("[Proxy Critical] PROXY_POOL secret is missing in Hugging Face environment variables!");
  }
  
  const PROXY_POOL = rawPool.split(',').map(url => url.trim());
  
  // Pick a random starting point to keep traffic distributed
  const startIndex = Math.floor(Math.random() * PROXY_POOL.length);
  let lastError = null;

  // Fallback Loop: Iterate through the entire pool if nodes fail
  for (let i = 0; i < PROXY_POOL.length; i++) {
    const currentIndex = (startIndex + i) % PROXY_POOL.length;
    const selectedProxy = PROXY_POOL[currentIndex];
    let targetUrl = '';

    if (selectedProxy.includes('codehooks.io')) {
      const apiKey = process.env.CODEHOOKS_API_KEY;
      targetUrl = `${selectedProxy}?apikey=${apiKey}&route=${discordRoute}`;
    } else if (selectedProxy.includes('supabase.co')) {
      targetUrl = `${selectedProxy}?route=${discordRoute}`;
    } else {
      targetUrl = `${selectedProxy}${discordRoute}`;
    }

    let body;
    const headers = {};

    if (fileBuffer && fileName) {
      const formData = new FormData();
      if (payload.embeds && payload.embeds[0]) {
        payload.embeds[0].image = { url: `attachment://${fileName}` };
      }
      formData.append('payload_json', JSON.stringify(payload));
      formData.append('files[0]', new Blob([fileBuffer], { type: 'image/png' }), fileName);
      body = formData;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(payload);
    }

    try {
      console.log(`[Global Proxy Router] Attempting Node: ${selectedProxy} (Try ${i + 1}/${PROXY_POOL.length})`);
      const response = await fetch(targetUrl, { method: 'PATCH', headers, body });
      
      if (!response.ok && [502, 503, 504].includes(response.status)) {
        console.warn(`[Global Proxy Router] Node ${selectedProxy} reported an environment error (${response.status}). Cycling to fallback...`);
        continue;
      }
      
      return response; 
      
    } catch (err) {
      console.warn(`[Global Proxy Router] Node ${selectedProxy} network down: ${err.message}. Cycling to fallback...`);
      lastError = err;
    }
  }
  
  throw new Error(`[Proxy Critical] All available proxy nodes exhausted! Last network exception: ${lastError?.message}`);
}

/**
 * General-purpose fetch tool using the same PROXY_POOL secret.
 * Optimized with explicit status tracking and strict failover rotation.
 */
export async function fetchViaProxy(discordRoute, options = {}) {
  const rawPool = process.env.PROXY_POOL;
  if (!rawPool) {
    throw new Error("[Proxy Critical] PROXY_POOL secret is missing in Hugging Face environment variables!");
  }

  const PROXY_POOL = rawPool.split(',').map(url => url.trim());
  const startIndex = Math.floor(Math.random() * PROXY_POOL.length);
  let lastError = null;

  for (let i = 0; i < PROXY_POOL.length; i++) {
    const currentIndex = (startIndex + i) % PROXY_POOL.length;
    const selectedProxy = PROXY_POOL[currentIndex];
    let targetUrl = '';

    if (selectedProxy.includes('codehooks.io')) {
      const apiKey = process.env.CODEHOOKS_API_KEY;
      targetUrl = `${selectedProxy}?apikey=${apiKey}&route=${discordRoute}`;
    } else if (selectedProxy.includes('supabase.co')) {
      targetUrl = `${selectedProxy}?route=${discordRoute}`;
    } else {
      targetUrl = `${selectedProxy}${discordRoute}`;
    }

    try {
      console.log(`[Mesh Data Router] Routing API call through Node: ${selectedProxy} (Try ${i + 1}/${PROXY_POOL.length})`);
      
      const response = await fetch(targetUrl, {
        ...options,
        signal: AbortSignal.timeout(4000) // 4-second timeout limit
      });

      // DIAGNOSTIC LOG: This will print the exact HTTP status code from your proxy node
      console.log(`[Mesh Data Router] Node response status: ${response.status} from ${selectedProxy}`);

      // If the response is successful (status 200-299), return it immediately!
      if (response.ok) {
        return response;
      }

      // If the proxy returns an error code, treat it as a node failure and cycle to the next one
      console.warn(`[Mesh Data Router] Node ${selectedProxy} returned bad status (${response.status}). Cycling to next fallback...`);
      
    } catch (err) {
      console.warn(`[Mesh Data Router] Node ${selectedProxy} failed query check: ${err.message}. Rotating...`);
      lastError = err;
    }
  }

  throw new Error(`[Proxy Mesh Exhausted] Failed all configured routes. Last error: ${lastError?.message}`);
}