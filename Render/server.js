const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Boost body limits so high-res welcome cards pass through safely
app.use(express.json({ limit: '15mb' }));
app.use(express.raw({ type: '*/*', limit: '15mb' }));

app.all('*', async (req, res) => {
    const targetUrl = req.headers['x-target-url'];
    if (!targetUrl) {
        return res.status(400).send('Missing "x-target-url" header.');
    }

    try {
        const cleanHeaders = { ...req.headers };
        // Remove host overrides to prevent SSL handshake errors on target
        delete cleanHeaders.host;
        delete cleanHeaders['x-target-url'];

        const response = await fetch(targetUrl, {
            method: req.method,
            headers: cleanHeaders,
            body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body
        });

        const data = await response.arrayBuffer();
        
        // Relay headers and status back to the main bot
        response.headers.forEach((value, key) => {
            res.setHeader(key, value);
        });
        
        res.status(response.status).send(Buffer.from(data));
    } catch (err) {
        res.status(500).send(`Proxy Node Error: ${err.message}`);
    }
});

app.listen(PORT, () => console.log(`Render Proxy online on port ${PORT}`));
