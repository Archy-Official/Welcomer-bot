import http from 'http';
import router from './router.js';

const PORT = process.env.PORT || 7860;

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;
  
  let bodyChunks = [];
  req.on('data', chunk => { bodyChunks.push(chunk); });
  
  req.on('end', async () => {
    const rawBody = Buffer.concat(bodyChunks).toString();
    
    try {
      await router(req, res, pathname, rawBody);
    } catch (err) {
      console.error('[Critical Server Crash]:', err);
      if (!res.writableEnded) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Internal Server Error Execution Fault' }));
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`[startup] Node.js ESM app server online via internal port ${PORT}`);
});
