# XcapeSnap - Wildlife Identification App

AI-powered wildlife identification app for Xcapeworld. Identify any animal instantly with your camera or by uploading a photo.

## Features

- 📷 Real-time camera wildlife identification
- 📤 Photo upload option (always works, no camera needed)
- 🎯 AI-powered species recognition via Gemini API
- ⚠️ Danger level assessment (1-5 scale)
- 📋 Encounter guidance (Do's and Don'ts)
- 💾 Save results as PDF
- 🔄 Share functionality
- 💳 Freemium model (5 free IDs/month, Pro upgrade available)

## Quick Deployment to GitHub Pages

### Step 1: Create GitHub Repository

1. Go to [GitHub.com](https://github.com) and sign in
2. Click the **+** button (top right) → **New repository**
3. Name it: `xcapesnap` (lowercase, no spaces)
4. Description: "XcapeSnap - Wildlife Identification App by Xcapeworld"
5. Set to **Public**
6. **DO NOT** check "Add a README" (we have one)
7. Click **Create repository**

### Step 2: Upload Files

1. On the new repository page, click **uploading an existing file**
2. Drag and drop these files:
   - `index.html` (the main app)
   - `README.md` (this file)
3. Scroll down, add commit message: "Initial XcapeSnap deployment"
4. Click **Commit changes**

### Step 3: Enable GitHub Pages

1. In your repository, click **Settings** (top right)
2. Scroll down left sidebar, click **Pages**
3. Under "Source", select: **Deploy from a branch**
4. Under "Branch", select: **main** and **/root**
5. Click **Save**
6. Wait 1-2 minutes for deployment

### Step 4: Access Your App

Your app will be live at:
```
https://firedragonlabs.github.io/xcapesnap/
```
(Replace `firedragonlabs` with your GitHub username if different)

### Step 5: Link from Xcapeworld

On your Xcapeworld Blogger page, add a link:

**Option A - Button/Link:**
```html
<a href="https://firedragonlabs.github.io/xcapesnap/" 
   target="_blank" 
   style="background:#F5C518;color:#0A0A0A;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">
   🦁 Launch XcapeSnap App
</a>
```

**Option B - Iframe Embed (if you still want embedded):**
```html
<iframe 
  src="https://firedragonlabs.github.io/xcapesnap/" 
  allow="camera;microphone"
  style="width:100%;height:100vh;border:none;">
</iframe>
```
Note: With GitHub Pages hosting + iframe `allow="camera"`, camera WILL work!

**Option C - Full Page Redirect:**
Just change your Blogger page to redirect to the GitHub Pages URL

## Updating the App

To update XcapeSnap after deployment:

1. Make changes to `index.html` locally
2. Go to your GitHub repository
3. Click on `index.html`
4. Click the pencil icon (Edit)
5. Paste your updated code
6. Click **Commit changes**
7. Changes go live in ~1 minute

## Configuration

### API Proxy URL
The app uses this proxy: `https://xcapesnap-app.onrender.com/identify`

This is your existing Render deployment - no changes needed.

### PayPal Pro Upgrade
Currently configured with:
- Plan ID: `P-3RX065706M3469222M5FQ32A`
- Unlock code: `XCAPESNAP99`
- Price: $9.99/month

### Free Usage Limit
- 5 identifications per month for free users
- Unlimited for Pro users

## Browser Compatibility

- Chrome 90+ ✓
- Safari 14+ ✓
- Firefox 88+ ✓
- Edge 90+ ✓
- Mobile browsers ✓

**Requirements:**
- HTTPS (GitHub Pages provides this automatically ✓)
- Camera permissions (user must allow when prompted)

## Local Testing

To test locally before deploying:

1. Open `index.html` in a browser
2. Camera won't work on `file://` protocol (security restriction)
3. Use Upload button for local testing
4. Or run a local server:
   ```bash
   python -m http.server 8000
   # Then visit http://localhost:8000
   ```

## Troubleshooting

### Camera Not Working
- Check browser camera permissions (click camera icon in address bar)
- Make sure you're on HTTPS (GitHub Pages is always HTTPS ✓)
- Try Upload button as fallback

### API Errors
- Check that Render proxy is running at `https://xcapesnap-app.onrender.com`
- Free Render instances sleep after inactivity - first request may be slow

### PayPal Button Not Showing
- Check browser console for errors
- Verify PayPal client ID is correct
- Make sure you're on HTTPS

## File Structure

```
xcapesnap/
├── index.html          # Main app (complete standalone HTML)
└── README.md          # This file
```

That's it! Single-file deployment.

## Tech Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **AI**: Google Gemini API (via proxy)
- **Payments**: PayPal Subscriptions
- **Hosting**: GitHub Pages
- **API Proxy**: Node.js/Express on Render

## Support

Questions or issues? Contact via Xcapeworld or check the GitHub Issues tab.

---

**XcapeSnap** - Created for Xcapeworld by Fire Dragon Labs
