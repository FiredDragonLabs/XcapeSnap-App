'use strict';

const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const crypto  = require('crypto');
const helmet  = require('helmet');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const GEMINI_KEY        = process.env.GEMINI_API_KEY;
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
const PAYPAL_CLIENT_ID  = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const API_SECRET        = process.env.XCAPESNAP_API_SECRET;

// ── GAP 5 FIX: HTTP Security Headers via Helmet ──
app.use(helmet({
  contentSecurityPolicy: false, // Disabled — proxy API, not serving HTML
  crossOriginEmbedderPolicy: false
}));

// ── ALLOWED MIME TYPES ──
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png',
  'image/webp', 'image/heic', 'image/heif'
]);

// ── ZERO-DEPENDENCY RATE LIMITER — 20 requests per IP per 10 minutes ──
const rateLimitMap = new Map();
const RATE_LIMIT_MAX    = 20;
const RATE_LIMIT_WINDOW = 10 * 60 * 1000;

function identifyLimiter(req, res, next) {
  const ip  = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return next();
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
  }
  entry.count++;
  return next();
}

// Prune stale IPs every 30 minutes to prevent memory bloat
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW) rateLimitMap.delete(ip);
  }
}, 30 * 60 * 1000);

// ── GAP 6 FIX: userID Validator — length cap + format check ──
function isValidUserID(id) {
  if (!id || typeof id !== 'string') return false;
  if (id.length < 8 || id.length > 128) return false;
  return /^[a-zA-Z0-9_\-\.]+$/.test(id);
}

// ── BINOMIAL NOMENCLATURE VALIDATOR ──
function isValidScientificName(name) {
  if (!name || typeof name !== 'string') return false;
  return /^[A-Z][a-z]+ [a-z]+( [a-z]+)?$/.test(name.trim());
}

// ── GAP 2 FIX: FILE-BASED PRO USER PERSISTENCE ──
// Survives in-process restarts and Render paid-tier persistent disks.
// Falls back gracefully to in-memory if filesystem is unavailable.
const PRO_STORE_PATH = path.join('/tmp', 'xcapesnap_pro_users.json');

function loadProUsers() {
  try {
    if (fs.existsSync(PRO_STORE_PATH)) {
      const raw = fs.readFileSync(PRO_STORE_PATH, 'utf8');
      const obj = JSON.parse(raw);
      const map = new Map();
      for (const [k, v] of Object.entries(obj)) map.set(k, v);
      console.log(`📂 Loaded ${map.size} Pro users from disk`);
      return map;
    }
  } catch (err) {
    console.warn('⚠️  Could not load Pro users from disk:', err.message);
  }
  return new Map();
}

function saveProUsers(map) {
  try {
    const obj = {};
    for (const [k, v] of map) obj[k] = v;
    fs.writeFileSync(PRO_STORE_PATH, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.warn('⚠️  Could not save Pro users to disk:', err.message);
  }
}

// Load Pro users on startup
const proUsers = loadProUsers();

// Helper: Check if user has Pro
function isProUser(userID) {
  return proUsers.has(userID) && proUsers.get(userID).subscribed === true;
}

// Helper: Activate Pro for user + persist immediately
function activateProUser(userID, subscriberID) {
  proUsers.set(userID, {
    subscribed: true,
    subscriberId: subscriberID,
    activatedAt: Date.now()
  });
  saveProUsers(proUsers);
  console.log(`✅ Pro activated and persisted for user: ${userID}`);
}

// ── GAP 1 FIX: PayPal Webhook Signature Verification ──
// Calls PayPal's own verification API — no fake webhooks can pass this check.
async function verifyPayPalWebhookSignature(req) {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET || !PAYPAL_WEBHOOK_ID) {
    console.warn('⚠️  PayPal credentials not fully configured — skipping signature verification');
    return true; // Fail open only if env vars are missing — log warning
  }

  try {
    // Step 1: Get PayPal OAuth access token
    const authHeader = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch(
      'https://api.paypal.com/v1/oauth2/token',
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
      }
    );

    if (!tokenRes.ok) {
      console.error('❌ PayPal token fetch failed:', tokenRes.status);
      return false;
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error('❌ PayPal access token missing from response');
      return false;
    }

    // Step 2: Verify webhook signature via PayPal API
    const verifyRes = await fetch(
      'https://api.paypal.com/v1/notifications/verify-webhook-signature',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          auth_algo:         req.headers['paypal-auth-algo'],
          cert_url:          req.headers['paypal-cert-url'],
          transmission_id:   req.headers['paypal-transmission-id'],
          transmission_sig:  req.headers['paypal-transmission-sig'],
          transmission_time: req.headers['paypal-transmission-time'],
          webhook_id:        PAYPAL_WEBHOOK_ID,
          webhook_event:     req.body
        })
      }
    );

    if (!verifyRes.ok) {
      console.error('❌ PayPal verification API error:', verifyRes.status);
      return false;
    }

    const verifyData = await verifyRes.json();
    const verified = verifyData.verification_status === 'SUCCESS';

    if (!verified) {
      console.warn('🚨 PayPal webhook signature FAILED verification. Possible spoofed request.');
    }

    return verified;

  } catch (err) {
    console.error('❌ PayPal signature verification exception:', err.message);
    return false;
  }
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

// ── GAP 3 FIX: TEST MODELS ENDPOINT — gated behind TEST_MODE ──
app.get('/test-models', async (req, res) => {
  if (process.env.TEST_MODE !== 'true') {
    return res.status(403).json({
      error: 'Endpoint disabled in production',
      message: 'Set TEST_MODE=true in environment variables to enable.'
    });
  }
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

// ── GAP 4 FIX: CHECK PRO STATUS — now rate limited + userID validated ──
app.get('/check-pro', identifyLimiter, (req, res) => {
  const userID = req.query.userid;

  // GAP 6 FIX: Validate userID format and length
  if (!isValidUserID(userID)) {
    return res.status(400).json({ error: 'Invalid or missing userid parameter' });
  }

  const isPro = isProUser(userID);
  return res.json({ isPro });
});

// ── TEST ENDPOINT - Activate Pro for Testing ──
// ONLY works when TEST_MODE=true in Render environment variables
app.post('/test-activate-pro', (req, res) => {
  if (process.env.TEST_MODE !== 'true') {
    return res.status(403).json({ 
      error: 'Test endpoint disabled',
      message: 'This endpoint only works in test mode. Set TEST_MODE=true in environment variables.'
    });
  }

  const { userID } = req.body;

  if (!isValidUserID(userID)) {
    return res.status(400).json({ error: 'Invalid or missing userID in request body' });
  }

  activateProUser(userID, 'TEST_SUBSCRIPTION_' + Date.now());
  console.log('✅ TEST: Pro activated for user:', userID);

  return res.json({ 
    success: true, 
    message: 'Pro activated for testing',
    userID: userID 
  });
});

// ── GAP 1 FIX: PAYPAL WEBHOOK — now with signature verification ──
app.post('/paypal-webhook', async (req, res) => {
  try {
    // Verify the webhook signature before processing anything
    const isVerified = await verifyPayPalWebhookSignature(req);

    if (!isVerified) {
      console.warn('🚨 Rejected unverified PayPal webhook from:', 
        req.headers['x-forwarded-for'] || req.socket.remoteAddress
      );
      // Return 200 anyway — PayPal expects 200 even on rejection
      // Returning non-200 causes PayPal to retry endlessly
      return res.status(200).json({ received: false, reason: 'signature_invalid' });
    }

    const webhookEvent = req.body;
    console.log('📥 Verified PayPal webhook received:', webhookEvent.event_type);

    // Handle subscription payment completed
    if (
      webhookEvent.event_type === 'PAYMENT.SALE.COMPLETED' || 
      webhookEvent.event_type === 'BILLING.SUBSCRIPTION.ACTIVATED'
    ) {
      const customData  = webhookEvent.resource?.custom || webhookEvent.resource?.custom_id;
      const subscriberID = webhookEvent.resource?.id;

      // GAP 6 FIX: Validate userID from PayPal payload before activating
      if (customData && isValidUserID(customData) && subscriberID) {
        activateProUser(customData, subscriberID);
      } else {
        console.warn('⚠️  PayPal webhook missing or invalid customData:', customData);
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('PayPal webhook error:', err.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ── PROXY ENDPOINT ──
app.post('/identify', identifyLimiter, async (req, res) => {
  // Shared secret header check — blocks direct API abuse
  if (API_SECRET) {
    const clientSecret = req.headers['x-xcapesnap-secret'];
    if (!clientSecret || clientSecret !== API_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const { imageData, mimeType } = req.body;

  if (!imageData || typeof imageData !== 'string') {
    return res.status(400).json({ error: 'Missing imageData' });
  }

  // Whitelist mimeType — reject non-image payloads
  const safeMime = (typeof mimeType === 'string' && ALLOWED_MIME_TYPES.has(mimeType.toLowerCase()))
    ? mimeType.toLowerCase()
    : 'image/jpeg';

  // Basic imageData sanity: must be non-trivial base64
  if (imageData.length < 100) {
    return res.status(400).json({ error: 'Invalid image data' });
  }

  if (!GEMINI_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // ── HARDENED PROMPT — strict animal-only guardrail ──
  const prompt = `You are XcapeSnap, a wildlife identification system for outdoor enthusiasts.

STRICT RULES — read ALL carefully before responding:
1. You ONLY identify real, verified animals that exist as confirmed species in the animal kingdom.
2. If the image contains a human, group of humans, or primarily shows a person — set noAnimalFound:true, rejectionReason:"no_animal", isVerifiedSpecies:false.
3. If the image contains no animal at all (objects, food, landscapes, vehicles, text, abstract images, etc.) — set noAnimalFound:true, rejectionReason:"no_animal", isVerifiedSpecies:false.
4. If the image is too blurry, dark, or unclear to confidently identify — set noAnimalFound:true, rejectionReason:"unclear_image", isVerifiedSpecies:false.
5. If the animal is in a drawing, cartoon, stuffed toy, or statue (not a real living creature) — set noAnimalFound:true, rejectionReason:"not_real_animal", isVerifiedSpecies:false.
6. CRITICAL: If the animal appears to be AI-generated, fictional, mythological, a fantasy creature, a hybrid that does not exist in nature, or any species that cannot be found in a real-world taxonomy database — set noAnimalFound:true, rejectionReason:"not_real_animal", isVerifiedSpecies:false. This includes dragons, griffins, chimeras, sci-fi creatures, or any creature you cannot assign a real Latin binomial scientific name to.
7. Do NOT attempt to identify or describe anything that is not a verified real animal with a known scientific name.
8. isVerifiedSpecies MUST be true only if you are confident this is a real, taxonomically verified species with a legitimate Latin binomial name. If you have any doubt, set it to false and reject.

FIELD INSTRUCTIONS:
- commonName: the well-known common name (e.g. "Gorilla")
- subspecies: the specific breed or subspecies if identifiable (e.g. "Western Lowland Gorilla"). If not determinable, use an empty string.
- scientificName: full Latin binomial (e.g. "Gorilla gorilla gorilla") — MUST be a real, verifiable scientific name
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
- isVerifiedSpecies: boolean — true ONLY if this is a confirmed real species with a valid scientific name

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
  "isVerifiedSpecies":false,
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
            { inlineData: { mimeType: safeMime, data: imageData } },
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

    // ── TRIPWIRE 1: noAnimalFound flag ──
    if (parsed.noAnimalFound) {
      const reason = parsed.rejectionReason || 'no_animal';
      const messages = {
        no_animal:       'No animal found. Point at a real animal and try again.',
        unclear_image:   'Image too unclear. Move closer or improve lighting and try again.',
        not_real_animal: 'XcapeSnap only identifies real living animals, not drawings, toys, or fictional creatures.'
      };
      return res.status(422).json({
        error: messages[reason] || messages['no_animal'],
        rejectionReason: reason
      });
    }

    // ── TRIPWIRE 2: isVerifiedSpecies cross-check ──
    if (parsed.isVerifiedSpecies === false && !parsed.scientificName) {
      return res.status(422).json({
        error: 'XcapeSnap only identifies real living animals, not drawings, toys, or fictional creatures.',
        rejectionReason: 'not_real_animal'
      });
    }

    // ── TRIPWIRE 3: scientificName must follow real Latin binomial format ──
    if (!isValidScientificName(parsed.scientificName)) {
      console.warn('Rejected: invalid scientificName format:', parsed.scientificName);
      return res.status(422).json({
        error: 'Could not verify this as a known species. Try a clearer image.',
        rejectionReason: 'not_real_animal'
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
