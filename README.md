# SmartFridge

Reducing household food waste: scans grocery receipts to add foods to your fridge, keeps track of when foods in your fridge expire, and generates recipes using your soon-to-expire foods.

## Features

- **Scan a receipt.** Take a photo. With AI on, a vision model reads it directly; otherwise on-device OCR ([Tesseract.js](https://github.com/naptha/tesseract.js)) does. Or paste the text.
- **Find the food.** Turns noisy receipt lines into generic food names with a shelf life ("PARM CHEESE 8OZ" becomes parmesan cheese, 60 days). Uses Claude or GPT (your choice) when configured, otherwise a built-in food list.
- **Review before saving.** Edit names and days, delete wrong rows, add your own.
- **Fridge.** Everything you have, soonest-expiring first, colour-coded. Edit, quantity, "used / remove", or add items by hand (leave days blank and it estimates the shelf life).
- **Soon to expire.** Slider from 1 to 14 days.
- **What can I make?** 3 short recipes that use the food expiring soonest (expired food is skipped). Claude or GPT (your choice) when configured, otherwise a built-in recipe book.
- **Works offline** once installed, and your data stays on your device.
- **Backup / restore** as a JSON file (Settings).

## How it fits together

```
phone (PWA)                                   Vercel
┌──────────────────────────────┐   only if AI is on   ┌─────────────────────────┐
│ UI, fridge data (localStorage)│ ───────────────────▶│ /api/receipt/parse      │──▶ Claude
│ OCR, food list, recipe book   │ ◀─────────────────── │ /api/receipt/scan       │
│                               │                       │ /api/recipes            │
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

Open http://localhost:3000. To try cloud AI, copy `.env.example` to `.env` and fill in a key; for free local AI, see "Free option" below. `npm run start:lan` makes the app reachable from your phone on the same Wi-Fi.

```bash
npm test
```

## Deploy to Vercel and install on your phone

You don't need a Mac or the Vercel CLI.

1. **Push this repo to GitHub** (it already lives at `KevinCapybara/SmartFridge-revised`).
2. On [vercel.com](https://vercel.com): **Add New > Project**, import the repo. Leave the framework as **Other**, with no build command. Vercel serves `public/` and turns `api/` into serverless functions.
3. *(Optional, for AI)* Under **Settings > Environment Variables** add one or both providers, plus the access code:
   - `ANTHROPIC_API_KEY`: your key from [console.anthropic.com](https://console.anthropic.com). Set a monthly spend limit there too.
   - `OPENAI_API_KEY`: your key from [platform.openai.com](https://platform.openai.com), if you want GPT as well.
   - `APP_ACCESS_CODE`: a long random string. **Required** whenever any key is set: your URL is public, so without a code anyone could use your keys. If you set a key without a code, the app refuses to use it.
   - Model overrides *(optional)*: `ANTHROPIC_RECEIPT_MODEL`, `ANTHROPIC_MODEL`, `OPENAI_RECEIPT_MODEL`, `OPENAI_MODEL`. See the table below.

   Redeploy after adding variables.
4. **On your iPhone, open the Vercel URL in Safari** > Share button > **Add to Home Screen**. (On Android Chrome: menu > **Install app**; the app also offers an Install button.)
5. Open the installed app, tap **Settings** and enter your `APP_ACCESS_CODE` once to unlock AI.

### Choosing the AI model

In the app, **Settings > AI models** has two toggles, saved on your device:

| Feature | Claude option (default) | OpenAI option (default) |
| --- | --- | --- |
| **Receipt scanning** (photo or text to food items) | `claude-haiku-5-5` ($0.10 / $0.50 per 1M tokens) | `gpt-6-luna` ($0.10 / $0.50) |
| **Recipe generation** | `claude-haiku-5-5` | `gpt-6-luna` |

Defaults are the fastest, cheapest tier of each provider, with reasoning effort set to low, because both jobs are short and structured and the app is used from a phone. For richer recipes at some cost in speed, set `ANTHROPIC_MODEL=claude-sonnet-5-5` and/or `OPENAI_MODEL=gpt-6.1-sol`. Latency was chosen by model tier, not benchmarked.

A provider appears only if it is set up on the server: its key is set, or (for the local option) Ollama is running with the models downloaded. The first available one in the order Claude, OpenAI, Local is the default until you choose. Receipt and recipe results say which model produced them. If an AI call fails, the app falls back to the built-in food list / recipe book and says so. Prices are from the vendors' pricing pages as of October 2026; the OpenAI model names are the newest listed on [OpenAI's model pricing page](https://developers.openai.com/api/docs/pricing), so check them before relying on the numbers.

OpenAI requests are sent with `store: false`, so OpenAI doesn't keep your receipts.

### Free option: open-source models on your own computer (no API key)

Pick **Local open-source** in Settings > AI models. It runs through [Ollama](https://ollama.com), costs nothing, needs no account or key, and your receipts never leave your machine.

| Job | Model | Size | Why |
| --- | --- | --- | --- |
| Receipt photos | `qwen3-vl:2b-instruct` (Qwen3-VL 2B) | 1.9 GB | Vision model with strong OCR, reads the photo directly |
| Recipes | `qwen3:4b-instruct` (Qwen3 4B) | 2.5 GB | Small, fast text model |

Both were chosen for a CPU-only laptop (tested on an Intel Core 7 150U, 16 GB RAM, no GPU). Use the `-instruct` tags: the plain `qwen3-vl:2b` and `qwen3:4b` tags are *thinking* models that spend all their time reasoning out loud and return nothing usable.

**Set up (Windows, PowerShell):**

1. Install Ollama from [ollama.com](https://ollama.com/download) (or unzip the portable build from its [GitHub releases](https://github.com/ollama/ollama/releases)) and start it. The installer runs it in the background; the portable build needs `ollama serve`.
2. Download the models once:
   ```bash
   ollama pull qwen3-vl:2b-instruct
   ollama pull qwen3:4b-instruct
   ```
3. Run the app on the same computer: `npm start`. Settings > AI models now offers the local models, and when no API key is set it is picked automatically.

**Use it from your phone:** the local model runs on your computer, so Vercel can't reach it (Vercel's servers can't see your PC). Instead, run `npm run start:lan`, which prints an address like `http://192.168.1.20:3000`. Open that on your phone while it's on the same Wi-Fi. Allow Node through the Windows firewall when asked. Because that address is plain `http`, iOS adds it to the Home Screen as a shortcut, but installable-app features (offline mode) need HTTPS, for example via a free [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) or [Tailscale](https://tailscale.com). Set `APP_ACCESS_CODE` if others share your network.

**Speed (measured on that laptop, CPU only):** about 60 seconds to read a receipt photo and about 55 seconds to write recipes (the first request is slower while the model loads). Cloud models take a few seconds, so use those when you can and the local ones when you can't.

**Accuracy:** on a tilted test receipt with 9 foods and 4 non-food lines, the 2B model read every food correctly. It is weak at judgment (it won't expand "CHKN BRST" or estimate shelf life), so the app passes its output through the built-in food list for generic names, shelf lives and dropping things like paper towels. Foods the list doesn't know keep the model's name and a default shelf life, which is why the review step matters. The 4B recipe model usually follows the fridge contents and expiry order but sometimes suggests odd combinations. For better results, try `LOCAL_RECEIPT_MODEL=qwen3-vl:4b-instruct` (3.3 GB, slower).

**Other OpenAI-compatible hosts** are not supported here: the local option speaks Ollama's own API. Point `LOCAL_LLM_URL` at an Ollama running on another machine (for example a home server) if you have one.

**If `ollama pull` fails** with a timeout to an `r2.cloudflarestorage.com` IPv6 address, your network can't reach Ollama's CDN over IPv6. Retrying, or downloading the failing file over IPv4 (`curl -4 -L`, from `registry.ollama.ai/v2/library/<model>/blobs/sha256:<hash>`, into `~/.ollama/models/blobs/sha256-<hash>`) and re-running the pull, fixes it.

### How receipt photos are read (hybrid)

1. **AI on** (default when a provider is unlocked): the phone shrinks the photo to a JPEG of roughly 0.3-1 MB (smaller for the local model), and the chosen model reads it directly with vision. Most accurate on crumpled or faded receipts.
2. **AI off, locked, offline, the call fails, or you turned off "Read receipt photos with AI" in Settings:** the photo is read on-device with OCR (Tesseract.js), you review the text, then "Find the food" parses it (with AI if available, otherwise the built-in food list).

With a cloud provider, the photo is sent to it (the app never stores it). With the local option it goes only to Ollama on your own computer. Turn "Read receipt photos with AI" off in Settings to keep photos on the phone and use on-device OCR.

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
lib/                 server code: api.js (handlers, access gate, provider choice), runtime.js,
                     ai.js (Claude), openai.js (GPT), local.js (Ollama), prompts.js (shared prompts/schemas), sanitize.js
server.js            local dev server (not used on Vercel)
scripts/make-icons.mjs   regenerates public/icons/*.png
test/                node:test suites
```

## Security and privacy

The repo is public, so keys never go in it. API keys live only in Vercel's environment variables or a git-ignored `.env`. A pre-commit hook and a GitHub Actions check block anything key-shaped, and your fridge data stays on your device. Details, and what to do if a key leaks, are in [SECURITY.md](SECURITY.md). Run `npm run check-secrets` to scan the whole repo.

## Limits and ideas

- Single user, single device: no sync between devices (export/import only).
- On-device OCR on crumpled thermal receipts is imperfect (the AI photo path is more accurate), which is why there is always a review step.
- Not yet built: push notifications for expiring food, barcode scanning, shopping list.
