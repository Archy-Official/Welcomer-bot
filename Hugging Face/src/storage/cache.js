const cache = new Map();

export async function getCached(key, fetchFn, ttlMs = 300000) {
  const cached = cache.get(key);
  
  if (cached) {
    if (Date.now() - cached.timestamp < ttlMs) {
      return cached.value;
    }
    // EFFICIENCY FIX: Drop the reference immediately if it is expired.
    // This stops stale data from piling up inside your container's RAM.
    cache.delete(key);
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
