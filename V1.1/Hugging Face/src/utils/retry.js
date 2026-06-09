export async function retry(fn, { attempts = 5, baseDelay = 2000 } = {}) {
  let lastError;
  
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      let delay = baseDelay * Math.pow(2, i);
      const msg = err.message?.toLowerCase() || '';
      
      if (msg.includes('econnreset') || msg.includes('tls') || msg.includes('socket')) {
        delay += 3000;
      }
      
      if (i < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}