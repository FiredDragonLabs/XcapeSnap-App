'use strict';

const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3000;

const GEMINI_KEY = process.env.GEMINI_API_KEY;

const ALLOWED_ORIGINS = [
  'https://www.xcapeworld.com',
  'https://xcapeworld.com',
  'https://fireddragonlabs.github.io'
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

  // ── HARDENED PROMPT — strict animal-only guardrail ──
  const prompt = `You are XcapeSnap, a wildlife identification system for outdoor enthusiasts.

STRICT RULES — read carefully before responding:
1. You ONLY identify real animals: mammals, birds, reptiles, amphibians, fish, insects, arachnids, marine life, or any other creature in the animal kingdom.
2. If the image contains a human, group of humans, or primarily shows a person — set noAnimalFound:true and rejectionReason:"no_animal".
3. If the image contains no animal at all (objects, food, landscapes, vehicles, text, abstract images, etc.) — set noAnimalFound:true and rejectionReason:"no_animal".
4. If the image is too blurry, dark, or unclear to confidently identify — set noAnimalFound:true and rejectionReason:"unclear_image".
5. If the animal is in a drawing, cartoon, stuffed toy, or statue (not a real living creature) — set noAnimalFound:true and rejectionReason:"not_real_animal".
6. Do NOT attempt to identify or describe anything that is not a real animal.

Respond ONLY in raw JSON (no markdown, no code blocks, no explanation):
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
  "noAnimalFound":false,
  "rejectionReason":""
}
dangerLevel 1=harmless, 2=caution, 3=moderate, 4=dangerous, 5=deadly.`;

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
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
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

    // ── SERVER-SIDE GUARDRAIL — double-check the rejection ──
    if (parsed.noAnimalFound) {
      const reason = parsed.rejectionReason || 'no_animal';
      const messages = {
        no_animal:       'No animal found. Point at a real animal and try again.',
        unclear_image:   'Image too unclear. Move closer or improve lighting and try again.',
        not_real_animal: 'XcapeSnap only identifies real living animals, not drawings or toys.'
      };
      return res.status(422).json({
        error: messages[reason] || messages['no_animal'],
        rejectionReason: reason
      });
    }

    return res.json(parsed);

  } catch (err) {
    console.error('Proxy error:', err.message);
    return res.status(500).json({ error: 'Proxy request failed' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => console.log(`XcapeSnap proxy listening on port ${PORT}`));
