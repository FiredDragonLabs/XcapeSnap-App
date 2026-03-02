'use strict';

const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── GEMINI KEY — stored in Render environment variable, never in code ──
const GEMINI_KEY = process.env.GEMINI_API_KEY;

// ── CORS — only allow requests from your Xcapeworld domain ──
const ALLOWED_ORIGINS = [
  'https://www.xcapeworld.com',
  'https://xcapeworld.com',
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  }
}));

app.use(express.json({ limit: '10mb' }));

// ── HEALTH CHECK ──
app.get('/', (req, res) => {
  res.json({ status: 'XcapeSnap proxy running' });
});

// ── PROXY ENDPOINT ──
app.post('/identify', async (req, res) => {
  const { imageData, mimeType } = req.body;

  if (!imageData || typeof imageData !== 'string') {
    return res.status(400).json({ error: 'Missing imageData' });
  }
  if (!GEMINI_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const prompt = `You are XcapeSnap, an expert wildlife identification system. Analyze this image.
Respond ONLY in raw JSON (no markdown, no code blocks):
{
  "commonName":"",
  "scientificName":"",
  "animalType":"",
  "dangerLevel":1,
  "dangerLabel":"",
  "description":"",
  "habitat":"",
  "encounterDo":["","",""],
  "encounterDont":["","",""],
  "funFact":"",
  "tags":["",""],
  "noAnimalFound":false
}
dangerLevel 1-5. If no animal visible set noAnimalFound:true.`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { inlineData: { mimeType: mimeType || 'image/jpeg', data: imageData } },
            { text: prompt }
          ]}],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
        })
      }
    );

    if (!geminiRes.ok) {
      const errBody = await geminiRes.json().catch(() => ({}));
      return res.status(geminiRes.status).json({
        error: errBody?.error?.message || `Gemini API error ${geminiRes.status}`
      });
    }

    const data = await geminiRes.json();
    let txt = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    txt = txt.replace(/```json\n?|```\n?/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(txt); }
    catch (e) { return res.status(422).json({ error: 'Could not parse response' }); }

    return res.json(parsed);

  } catch (err) {
    console.error('Proxy error:', err.message);
    return res.status(500).json({ error: 'Proxy request failed' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => console.log(`XcapeSnap proxy listening on port ${PORT}`));
