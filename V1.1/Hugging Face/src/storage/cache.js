const cache = new Map();

export async function getCached(key, fetchFn, ttlMs = 300_000) {
  const entry = cache.get(key);

  if (entry) {
    if (Date.now() - entry.timestamp < ttlMs) return entry.value;
    cache.delete(key); // evict stale entry before re-fetching
  }

  const value = await fetchFn();
  cache.set(key, { value, timestamp: Date.now() });
  return value;
}

export function invalidateCache(key) {
  cache.delete(key);
}

export function clearCache() {
  cache.clear();
}