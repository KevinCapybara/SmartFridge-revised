# SmartFridge (revised)

Scan a grocery receipt, keep track of what's in your fridge, see what's about to expire, and get recipes that use it up.

A rebuild of the original SmartFridge (a TritonHacks 2024 MIT App Inventor app, [KevinCapybara/SmartFridge](https://github.com/KevinCapybara/SmartFridge)) as an installable **PWA**, so one codebase runs on **iPhone and Android** and deploys to **Vercel**.

## Features

- **Scan a receipt.** Take a photo; on-device OCR ([Tesseract.js](https://github.com/naptha/tesseract.js)) reads it. Or paste the text.
- **Find the food.** Turns noisy receipt lines into generic food names with a shelf life ("PARM CHEESE 8OZ" becomes parmesan cheese, 60 days). Uses Claude when configured, otherwise a built-in food list.
- **Review before saving.** Edit names and days, delete wrong rows, add your own.
- **Fridge.** Everything you have, soonest-expiring first, colour-coded. Edit, quantity, "used / remove", or add items by hand (leave days blank and it estimates the shelf life).
- **Soon to expire.** Slider from 1 to 14 days.
- **What can I make?** 3 short recipes that use the food expiring soonest (expired food is skipped). Claude when configured, otherwise a built-in recipe book.
- **Works offline** once installed, and your data stays on your device.
- **Backup / restore** as a JSON file (Settings).

## How it fits together

```
phone (PWA)                                   Vercel
┌──────────────────────────────┐   only if AI is on   ┌─────────────────────────┐
│ UI, fridge data (localStorage)│ ───────────────────▶│ /api/receipt/parse      │──▶ Claude
│ OCR, food list, recipe book   │ ◀─────────────────── │ /api/recipes            │
└──────────────────────────────┘     JSON              │ /api/health             │
                                                       └─────────────────────────┘
```

- **The fridge lives on the phone** (localStorage), like TinyDB in the original app. There is no database and no login.
- **The server only does the optional AI calls.** Every AI feature falls back to the built-in rules if the key is missing, the server is unreachable, or a call fails, so the app always works.
- Dates are plain `YYYY-MM-DD` strings. The old app stored "30 days" and never counted down; this one stores a real expiry date.

## Run locally

Needs Node 20.12 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. To try the AI features, copy `.env.example` to `.env` and fill in `ANTHROPIC_API_KEY`.

```bash
npm test
```

## Deploy to Vercel and install on your phone

You don't need a Mac or the Vercel CLI.

1. **Push this repo to GitHub** (it already lives at `KevinCapybara/SmartFridge-revised`).
2. On [vercel.com](https://vercel.com): **Add New > Project**, import the repo. Leave the framework as **Other**, with no build command. Vercel serves `public/` and turns `api/` into serverless functions.
3. *(Optional, for AI)* Under **Settings > Environment Variables** add:
   - `ANTHROPIC_API_KEY`: your key from [console.anthropic.com](https://console.anthropic.com). Set a monthly spend limit there too.
   - `APP_ACCESS_CODE`: a long random string. **Required** whenever the key is set: your URL is public, so without a code anyone could use your key. If you set the key without a code, the app refuses to use it.
   - `ANTHROPIC_MODEL` *(optional)*: defaults to `claude-opus-5-5`. `claude-haiku-5-5` is much cheaper and faster for this job.

   Redeploy after adding variables.
4. **On your iPhone, open the Vercel URL in Safari** > Share button > **Add to Home Screen**. (On Android Chrome: menu > **Install app**; the app also offers an Install button.)
5. Open the installed app, tap **Settings** and enter your `APP_ACCESS_CODE` once to unlock AI.

### iPhone notes

- Install from **Safari** and **add items from the installed app**. A home-screen app has its own storage, separate from Safari tabs, so anything added in a Safari tab will not appear in the installed app. Use Settings > Export / Import backup to move data between them or to a new phone.
- Installed apps are not subject to Safari's 7-day storage cleanup, but clearing website data in iOS Settings will erase the fridge. Export a backup now and then.
- The first receipt scan downloads the OCR library, so it needs a connection once.
- iOS needs 16.4+ for the best PWA support.

## Project layout

```
public/              static site (what Vercel serves)
  index.html, app.js, styles.css
  manifest.webmanifest, sw.js, icons/   PWA install + offline
  shared/            logic used by the browser and the tests
    foods.js         shelf-life table + matching
    receipt.js       offline receipt parser
    recipes.js       offline recipe book
    items.js         validation, expiry, filtering
    storage.js       localStorage persistence, backup/restore
    dates.js
api/                 Vercel serverless functions (thin wrappers)
lib/                 server code: api.js (handlers + access gate), ai.js (Claude), runtime.js, sanitize.js
server.js            local dev server (not used on Vercel)
scripts/make-icons.mjs   regenerates public/icons/*.png
test/                node:test suites
```

## Limits and ideas

- Single user, single device: no sync between devices (export/import only).
- OCR on crumpled thermal receipts is imperfect, which is why there is a review step. Sending the photo straight to Claude's vision instead of OCR would be more accurate.
- Not yet built: push notifications for expiring food, barcode scanning, shopping list.
