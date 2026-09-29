# Language Plugin

Embeddable snippet for any website: floating language button (right, vertically centered) with **Tamil**, **Hindi**, **Malayalam**, **Telugu**, and **Kannada**. The page stays **English** until the visitor picks a language.

- **Firebase Hosting** serves `embed.js` and routes `/api/translate` to the Cloud Function
- **Firebase Cloud Functions** call Gemini with the API key kept server-side
- **Firebase Firestore** caches translations shared by all visitors (optional; translation still works without it)

## Configuration (`.env`)

All keys and settings live in `.env` at the project root, which is gitignored. Start from the template:

```bash
cp .env.example .env
```

| Variable | Used by |
|----------|---------|
| `FIREBASE_PROJECT_ID` | `npm run deploy` / `npm run serve` (which Firebase project to use) |
| `GEMINI_API_KEY` | Translation API (local server, and Secret Manager in production) |
| `GEMINI_MODEL` | Translation API (Gemini model name) |
| `PORT` | Local dev server |
| `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID` | Stored for reference; not read by the current code |

## Snippet (paste inside `<head>` on any site)

```html
<script src="https://YOUR_FIREBASE_PROJECT_ID.web.app/embed.js"></script>
```

After deploying, `https://YOUR_FIREBASE_PROJECT_ID.web.app/snippet.html` shows the exact snippet for your project.

What it does on the host site:

- Translates visible text, the page title, `title` / `alt` / `placeholder` / `aria-label` attributes and button labels.
- Translates content that appears later (React/Vue/Angular apps, carousels, lazy-loaded sections).
- Remembers the visitor's choice in an `lp_lang` cookie (1 year) and caches translations in the browser, so reloads show the chosen language immediately.
- Keeps the current language on screen while a new one is loading.
- The widget lives in a Shadow DOM, so the host site's CSS can't break it.

Placing the script in `<head>` without `defer` prevents a flash of English on reload.

### Options for site owners

- Exclude content from translation with `translate="no"` or `class="notranslate"`:

  ```html
  <span translate="no">Brand Name</span>
  ```

- The snippet sends translation requests to the same server it was loaded from. If you host `embed.js` yourself, point it at the API:

  ```html
  <script src="/js/embed.js" data-api-url="https://YOUR_FIREBASE_PROJECT_ID.web.app/api/translate"></script>
  ```

- JavaScript API: `LanguagePlugin.setLanguage("hi")`, `LanguagePlugin.getLanguage()`, `LanguagePlugin.refresh()`.

## Deploy

Cloud Functions and secrets need the Firebase **Blaze** (pay-as-you-go) plan.

```bash
firebase login --reauth
cd functions && npm install && cd ..
npm run deploy
```

`npm run deploy` reads `.env`, deploys to `FIREBASE_PROJECT_ID`, writes `GEMINI_MODEL` to `functions/.env`, and saves `GEMINI_API_KEY` to Secret Manager whenever it changes.

## Local development

```bash
npm run dev
```

Reads `.env` and serves `public/` plus `/api/translate` at `http://localhost:3456`. Any other local site can load `http://localhost:3456/embed.js` to test.

## Security notes

- Keys belong only in `.env` (and Secret Manager in production), never in `embed.js` or committed files.
- The API accepts requests from any website, so anyone who finds it can use your Gemini quota. Set a budget alert in Google Cloud.
- Rotate any API key that was shared in chat.

## Files

| Path | Purpose |
|------|---------|
| `public/embed.js` | The snippet: widget + page translation |
| `functions/translate-core.js` | Gemini request logic shared by production and local dev |
| `functions/index.js` | Cloud Function `/api/translate` with Firestore cache |
| `scripts/local-dev.mjs` | Local server for `npm run dev` |
| `scripts/firebase.mjs` | Runs the Firebase CLI with settings from `.env` |
| `public/sample-landing.html` | Shriram sample landing page |
