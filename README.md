# Language Plugin

Embeddable snippet for any website: floating language button (right, vertically centered) with **Tamil**, **Hindi**, **Malayalam**, **Telugu**, and **Kannada**. The page stays **English** until the visitor picks a language.

- **Firebase Hosting** serves `embed.js` and routes `/api/translate` to the Cloud Function
- **Firebase Cloud Functions** call Gemini (`gemini-3.1-flash-lite`) with the API key kept server-side
- **Firebase Firestore** caches translations shared by all visitors (optional; translation still works without it)

## Snippet (paste inside `<head>` on any site)

```html
<script src="https://language-plugin-b251c.web.app/embed.js"></script>
```

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

- If you host `embed.js` yourself, point it at the API:

  ```html
  <script src="/js/embed.js" data-api-url="https://language-plugin-b251c.web.app/api/translate"></script>
  ```

- JavaScript API: `LanguagePlugin.setLanguage("hi")`, `LanguagePlugin.getLanguage()`, `LanguagePlugin.refresh()`.

## Deploy

Cloud Functions and secrets need the Firebase **Blaze** (pay-as-you-go) plan.

```bash
firebase login --reauth
cd functions && npm install && cd ..
firebase functions:secrets:set GEMINI_API_KEY   # paste the Gemini key when prompted
firebase deploy
```

Demo after deploy: `https://language-plugin-b251c.web.app/sample-landing.html`

## Local development

```bash
npm run dev
```

Reads `GEMINI_API_KEY` from `.env.local` (gitignored) and serves `public/` plus `/api/translate` at `http://localhost:3456`. Any other local site can load `http://localhost:3456/embed.js` to test.

## Security notes

- The Gemini key must only live in `.env.local` (local) and Cloud Functions secrets (production), never in `embed.js`.
- The API accepts requests from any website, so anyone who finds it can use your Gemini quota. Set a budget alert in Google Cloud.
- Rotate any API key that was shared in chat.

## Files

| Path | Purpose |
|------|---------|
| `public/embed.js` | The snippet: widget + page translation |
| `functions/translate-core.js` | Gemini request logic shared by production and local dev |
| `functions/index.js` | Cloud Function `/api/translate` with Firestore cache |
| `scripts/local-dev.mjs` | Local server for `npm run dev` |
| `public/sample-landing.html` | Shriram sample landing page |
