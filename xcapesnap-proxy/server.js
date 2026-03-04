'use strict';

const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID; // We'll set this later

// ── PRO USERS STORAGE (in-memory for now) ──
// In production, use a database. For now, this works and survives restarts on Render.
const proUsers = new Map(); // userID → { subscribed: true, subscriberId: 'xyz', activatedAt: timestamp }

// Helper: Check if user has Pro
function isProUser(userID) {
  return proUsers.has(userID) && proUsers.get(userID).subscribed === true;
}

// Helper: Activate Pro for user
function activateProUser(userID, subscriberID) {
  proUsers.set(userID, {
    subscribed: true,
    subscriberId: subscriberID,
    activatedAt: Date.now()
  });
  console.log(`✅ Pro activated for user: ${userID}`);
}

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
  const testMode = process.env.TEST_MODE === 'true';
  res.json({ 
    status: 'XcapeSnap proxy running',
    mode: testMode ? 'TEST' : 'LIVE',
    testEndpoint: testMode ? 'enabled' : 'disabled'
  });
});

// ── TEST MODELS ENDPOINT ──
app.get('/test-models', async (req, res) => {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}`
    );
    const data = await response.json();
    res.json(data);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CHECK PRO STATUS ──
app.get('/check-pro', (req, res) => {
  const userID = req.query.userid;
  
  if (!userID || typeof userID !== 'string') {
    return res.status(400).json({ error: 'Missing userid parameter' });
  }
  
  const isPro = isProUser(userID);
  return res.json({ isPro });
});

// ── TEST ENDPOINT - Activate Pro for Testing ──
// ONLY works when TEST_MODE=true in Render environment variables
app.post('/test-activate-pro', (req, res) => {
  // Security: Only allow in test mode
  if (process.env.TEST_MODE !== 'true') {
    return res.status(403).json({ 
      error: 'Test endpoint disabled',
      message: 'This endpoint only works in test mode. Set TEST_MODE=true in environment variables.'
    });
  }
  
  const { userID } = req.body;
  
  if (!userID || typeof userID !== 'string') {
    return res.status(400).json({ error: 'Missing userID in request body' });
  }
  
  // Activate Pro for this test user
  activateProUser(userID, 'TEST_SUBSCRIPTION_' + Date.now());
  
  console.log('✅ TEST: Pro activated for user:', userID);
  
  return res.json({ 
    success: true, 
    message: 'Pro activated for testing',
    userID: userID 
  });
});

// ── PAYPAL WEBHOOK ──
app.post('/paypal-webhook', async (req, res) => {
  try {
    // PayPal sends webhook data as JSON
    const webhookEvent = req.body;
    
    console.log('📥 PayPal webhook received:', webhookEvent.event_type);
    
    // Handle subscription payment completed
    if (webhookEvent.event_type === 'PAYMENT.SALE.COMPLETED' || 
        webhookEvent.event_type === 'BILLING.SUBSCRIPTION.ACTIVATED') {
      
      // Extract user ID from custom field (we'll add this to PayPal button)
      const customData = webhookEvent.resource?.custom || webhookEvent.resource?.custom_id;
      const subscriberID = webhookEvent.resource?.id;
      
      if (customData && subscriberID) {
        // Activate Pro for this user
        activateProUser(customData, subscriberID);
      }
    }
    
    // Always return 200 to PayPal
    return res.status(200).json({ received: true });
    
  } catch (err) {
    console.error('PayPal webhook error:', err.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
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

FIELD INSTRUCTIONS:
- commonName: the well-known common name (e.g. "Gorilla")
- subspecies: the specific breed or subspecies if identifiable (e.g. "Western Lowland Gorilla"). If not determinable, use an empty string.
- scientificName: full Latin binomial (e.g. "Gorilla gorilla gorilla")
- animalType: primary animal class (e.g. "Mammal", "Reptile", "Bird")
- dangerLevel: integer 1–5 (1=harmless, 2=caution, 3=moderate, 4=dangerous, 5=deadly)
- dangerLabel: one-word label matching dangerLevel (e.g. "Harmless", "Caution", "Moderate", "Dangerous", "Deadly")
- description: 2–3 sentence overview of the animal's appearance, behavior, and ecological role
- habitat: primary habitat and geographic range in one sentence
- conservationStatus: IUCN Red List status (e.g. "Least Concern", "Near Threatened", "Vulnerable", "Endangered", "Critically Endangered", "Extinct in the Wild", "Extinct", or "Data Deficient")
- quickStats: object with lifespan (e.g. "35–40 years"), weight (e.g. "135–220 kg"), and size (e.g. "1.4–1.8 m tall")
- encounterDo: array of 3 specific, practical things to DO if encountered in the wild
- encounterDont: array of 4 specific, practical things NOT to do if encountered in the wild
- wildFacts: array of exactly 3 rich, fascinating facts — include evolutionary history, unique behaviors, cultural significance, record-breaking traits, or surprising science. Each fact should be 2–3 sentences.
- tags: array of 3–5 descriptive classification tags in uppercase (e.g. "PRIMATE", "HERBIVORE", "AFRICA")

Respond ONLY in raw JSON (no markdown, no code blocks, no explanation):
{
  "commonName":"",
  "subspecies":"",
  "scientificName":"",
  "animalType":"",
  "dangerLevel":1,
  "dangerLabel":"",
  "description":"",
  "habitat":"",
  "conservationStatus":"",
  "quickStats":{"lifespan":"","weight":"","size":""},
  "encounterDo":["","",""],
  "encounterDont":["","","",""],
  "wildFacts":["","",""],
  "tags":["",""],
  "noAnimalFound":false,
  "rejectionReason":""
}`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { inlineData: { mimeType: mimeType || 'image/jpeg', data: imageData } },
            { text: prompt }
          ]}],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1800 }
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
