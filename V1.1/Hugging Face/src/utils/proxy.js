const PROXY_TIMEOUT_MS = 4000;

/**
 * Sorts proxy URLs into a deterministic priority order based on provider.
 * Priority is derived from measured latency during initial architecture testing.
 *
 *  1. Port-based custom IP routers  (fastest, self-hosted)
 *  2. Codehooks.io
 *  3. Supabase Edge Functions
 *  4. Deno Deploy
 *  5. Everything else
 */
function prioritizePool(urls) {
  const tiers = [
    url => url.includes('12333'),
    url => url.includes('codehooks.io'),
    url => url.includes('supabase.co'),
    url => url.includes('deno.dev') || url.includes('deno.deploy'),
  ];

  const seen   = new Set();
  const sorted = [];

  for (const tier of tiers) {
    for (const url of urls) {
      if (tier(url) && !seen.has(url)) {
        sorted.push(url);
        seen.add(url);
      }
    }
  }

  // Append anything that didn't match a known tier
  for (const url of urls) {
    if (!seen.has(url)) sorted.push(url);
  }

  return sorted;
}

function buildProxyUrl(proxyBase, discordRoute) {
  if (proxyBase.includes('codehooks.io')) {
    const key = process.env.CODEHOOKS_API_KEY;
    return `${proxyBase}?apikey=${key}&route=${discordRoute}`;
  }
  if (proxyBase.includes('supabase.co') || proxyBase.includes('12333')) {
    return `${proxyBase}?route=${discordRoute}`;
  }
  if (proxyBase.includes('deno.dev') || proxyBase.includes('deno.deploy')) {
    const sep = proxyBase.includes('?') ? '&' : '?';
    return `${proxyBase}${sep}route=${discordRoute}`;
  }
  return `${proxyBase}${discordRoute}`;
}

function getPool() {
  const raw = process.env.PROXY_POOL;
  if (!raw) throw new Error('[proxy] PROXY_POOL environment variable is not set.');
  return prioritizePool(raw.split(',').map(u => u.trim()));
}

/**
 * PATCHes a webhook response back to Discord through the proxy pool.
 * Iterates the priority list and falls through on 5xx or network errors.
 */
export async function patchWebhook(clientId, token, payload, fileBuffer = null, fileName = null) {
  const route = `/v10/webhooks/${clientId}/${token}/messages/@original`;
  const pool  = getPool();
  let lastError;

  for (let i = 0; i < pool.length; i++) {
    const proxy = pool[i];
    const url   = buildProxyUrl(proxy, route);

    let body;
    const headers = {};

    if (fileBuffer && fileName) {
      const form = new FormData();
      if (payload.embeds?.[0]) payload.embeds[0].image = { url: `attachment://${fileName}` };
      form.append('payload_json', JSON.stringify(payload));
      form.append('files[0]', new Blob([fileBuffer], { type: 'image/png' }), fileName);
      body = form;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(payload);
    }

    try {
      console.log(`[proxy] patchWebhook attempt ${i + 1}/${pool.length} via ${proxy}`);
      const resp = await fetch(url, { method: 'PATCH', headers, body });

      if ([502, 503, 504].includes(resp.status)) {
        console.warn(`[proxy] ${proxy} returned ${resp.status} — trying next node`);
        continue;
      }

      return resp;
    } catch (err) {
      console.warn(`[proxy] ${proxy} unreachable: ${err.message}`);
      lastError = err;
    }
  }

  throw new Error(`[proxy] All nodes exhausted. Last error: ${lastError?.message}`);
}

/**
 * General-purpose Discord API fetch routed through the proxy pool.
 */
export async function fetchViaProxy(discordRoute, options = {}) {
  const pool = getPool();
  let lastError;

  for (let i = 0; i < pool.length; i++) {
    const proxy = pool[i];
    const url   = buildProxyUrl(proxy, discordRoute);

    try {
      console.log(`[proxy] fetchViaProxy attempt ${i + 1}/${pool.length} via ${proxy}`);
      const resp = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      });

      if (resp.ok) return resp;

      console.warn(`[proxy] ${proxy} returned ${resp.status} — trying next node`);
    } catch (err) {
      console.warn(`[proxy] ${proxy} failed: ${err.message}`);
      lastError = err;
    }
  }

  throw new Error(`[proxy] All nodes exhausted. Last error: ${lastError?.message}`);
}