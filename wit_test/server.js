// server.js
import express from 'express';
import bodyParser from 'body-parser';
import 'dotenv/config';
import { askWit, askGemini, generateResponse } from './witTest.js';

const app = express();
const port = 3000;

app.use(bodyParser.json());

app.post('/chat', async (req, res) => {
    const userMessage = req.body.message;

    if (!userMessage) {
        return res.status(400).json({ error: 'message alanı zorunludur' });
    }

    try {
        const witData = await askWit(userMessage);
        const botResponse = await generateResponse(witData, userMessage);
        res.json({ reply: botResponse });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.listen(port, () => {
    console.log(`🟢 API sunucusu http://localhost:${port} üzerinden çalışıyor.`);
});
