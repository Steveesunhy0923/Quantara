## Cloudflare Pages (recommended frontend deploy)

This repo’s **frontend** is the Vite/React app in `app/`. The **backend** is still Firebase (Firestore/Storage/Auth + Functions in `functions/`).

### 1) Connect Git → auto-deploy on every push

In Cloudflare Dashboard:

- Go to **Pages** → **Create a project** → **Connect to Git**
- Pick your GitHub repo + the production branch (usually `main`)
- Set:
  - **Root directory**: `app`
  - **Build command**: `npm run build`
  - **Build output directory**: `dist`

Tip: Vite 7 works best on Node 20+. In Cloudflare Pages, set **Environment variables** → `NODE_VERSION=20`.

### 2) Environment variables (Cloudflare Pages → Settings → Environment variables)

Add these (from Firebase Console → Project settings → Your apps):

- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`

If you use Firebase App Check (reCAPTCHA v3), also add:

- `VITE_APPCHECK_RECAPTCHA_V3_SITE_KEY`

### 3) SPA routing (React Router)

This repo includes `app/public/_redirects` so Cloudflare Pages serves `index.html` for all routes (deep links like `/wiki` won’t 404).

### 4) Custom domain (quantara.org)

In Cloudflare Pages → your project → **Custom domains**:

- Add `quantara.org`
- Add `www.quantara.org` (optional)

Cloudflare will guide you to create DNS records (typically CNAMEs) pointing the domain(s) at your `*.pages.dev` hostname.

## Math Web / Quantara

This repo currently contains:
- **React app (source of truth)**: `app/src` (built output: `app/dist`)
- **Legacy static pages** (older prototypes): `community.html`, `new-post.html`, etc.

### How to test the React Community page

Run the React dev server:

```bash
cd app
npm run dev
```

Then open:
- `http://localhost:5173/community` (community feed + image lightbox)
- `http://localhost:5173/new` (new post + multi-image upload)

### Notes

- Firebase Hosting is configured to serve **`app/dist`** (`firebase.json`), so you must run `cd app && npm run build` before deploying.
- The legacy pages now redirect to the React routes when served over HTTP(S) to avoid testing the wrong UI by accident.

### Firebase App Check (important)

Your app initializes **Firebase App Check (reCAPTCHA v3)** in `app/src/lib/firebase.js`.

If App Check is enabled/enforced in Firebase Console and your web build is missing a valid reCAPTCHA site key (or the key’s allowed domains don’t include your site), you will see:
- `appCheck/recaptcha-error` in the browser console
- and often `permission-denied` when writing to Firestore / uploading to Storage

To configure the client build, export these env vars before building/deploying:

```bash
cd app
cp env.example .env.local
# edit .env.local and set:
# - VITE_FIREBASE_APP_ID
# - VITE_FIREBASE_MESSAGING_SENDER_ID
# - VITE_APPCHECK_RECAPTCHA_V3_SITE_KEY
cd ..
npm run deploy
```

You can find the App ID / sender ID in Firebase Console → Project settings → Your apps → Web app config.

Debug: open any page with `?fbdebug=1` and run `await __fbdebug.check()` in DevTools.
