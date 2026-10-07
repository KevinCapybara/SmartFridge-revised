// Local dev server: serves public/ and mounts the same /api handlers Vercel runs.
// Not used in production - Vercel serves public/ and api/ directly.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const here = path.dirname(fileURLToPath(import.meta.url));

// Load .env if present (ANTHROPIC_API_KEY etc). Real environment variables win.
if (fs.existsSync(path.join(here, '.env'))) process.loadEnvFile(path.join(here, '.env'));

const { getApi, resolveConfig, toNodeHandler } = await import('./lib/runtime.js');
const { redact } = await import('./lib/redact.js');

const app = express();
app.disable('x-powered-by');
// Photos arrive as base64 JSON (the app downsizes them first), so this route needs a bigger limit.
app.use('/api/receipt/scan', express.json({ limit: '5mb' }));
app.use('/api', express.json({ limit: '256kb' }));

const api = () => getApi();
app.all('/api/health', toNodeHandler((req) => api().health(req)));
app.all('/api/receipt/parse', toNodeHandler((req) => api().parseReceipt(req)));
app.all('/api/receipt/scan', toNodeHandler((req) => api().scanReceipt(req)));
app.all('/api/recipes', toNodeHandler((req) => api().recipes(req)));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', code: 'not_found' }));

// The service worker must never be served stale during development.
app.use(express.static(path.join(here, 'public'), { setHeaders: (res, p) => p.endsWith('sw.js') && res.setHeader('Cache-Control', 'no-cache') }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON', code: 'bad_request' });
  console.error(redact(err));
  res.status(500).json({ error: 'Internal error', code: 'internal' });
});

const port = Number(process.env.PORT) || 3000;
// Localhost only by default: there is no login, so don't expose it to the network unless asked.
// `npm run start:lan` (or HOST=0.0.0.0) makes it reachable from your phone on the same Wi-Fi.
const lan = process.argv.includes('--lan');
const host = process.env.HOST || (lan ? '0.0.0.0' : '127.0.0.1');

/** This computer's private-network addresses, for opening the app from a phone. */
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

app.listen(port, host, () => {
  const { providers, disabledReason } = resolveConfig();
  console.log(`SmartFridge running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  if (host === '0.0.0.0') {
    for (const ip of lanAddresses()) console.log(`  On your phone (same Wi-Fi): http://${ip}:${port}`);
    if (!process.env.APP_ACCESS_CODE) console.log('  Anyone on this network can use the app. Set APP_ACCESS_CODE in .env to require a code for AI features.');
  }
  const names = Object.keys(providers);
  if (names.length === 0) {
    console.log(`AI features off (${disabledReason}). Set a key in .env, or run Ollama; the built-in food list and recipes still work.`);
  }
  for (const name of names) {
    console.log(`AI provider "${name}" configured (receipts: ${providers[name].models.receipt}, recipes: ${providers[name].models.recipes})`);
  }
  if (providers.local) {
    providers.local.status().then((s) =>
      console.log(
        !s.reachable
          ? 'Local models: Ollama not running (start it and the option appears in Settings > AI models).'
          : `Local models: Ollama is up. Receipts model ${s.ready.receipt ? 'ready' : `missing (ollama pull ${providers.local.models.receipt})`}, recipes model ${s.ready.recipes ? 'ready' : `missing (ollama pull ${providers.local.models.recipes})`}.`,
      ),
    );
  }
});
