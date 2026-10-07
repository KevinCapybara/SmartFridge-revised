// Local dev server: serves public/ and mounts the same /api handlers Vercel runs.
// Not used in production - Vercel serves public/ and api/ directly.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const here = path.dirname(fileURLToPath(import.meta.url));

// Load .env if present (ANTHROPIC_API_KEY etc). Real environment variables win.
if (fs.existsSync(path.join(here, '.env'))) process.loadEnvFile(path.join(here, '.env'));

const { getApi, resolveConfig, toNodeHandler } = await import('./lib/runtime.js');

const app = express();
app.disable('x-powered-by');
app.use('/api', express.json({ limit: '256kb' }));

const api = () => getApi();
app.all('/api/health', toNodeHandler((req) => api().health(req)));
app.all('/api/receipt/parse', toNodeHandler((req) => api().parseReceipt(req)));
app.all('/api/recipes', toNodeHandler((req) => api().recipes(req)));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', code: 'not_found' }));

// The service worker must never be served stale during development.
app.use(express.static(path.join(here, 'public'), { setHeaders: (res, p) => p.endsWith('sw.js') && res.setHeader('Cache-Control', 'no-cache') }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON', code: 'bad_request' });
  console.error(err);
  res.status(500).json({ error: 'Internal error', code: 'internal' });
});

const port = Number(process.env.PORT) || 3000;
// Localhost only by default: there is no login, so don't expose it to the network unless asked.
const host = process.env.HOST || '127.0.0.1';

app.listen(port, host, () => {
  const { providers, disabledReason } = resolveConfig();
  console.log(`SmartFridge (revised) running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  const names = Object.keys(providers);
  if (names.length === 0) {
    console.log(`AI features off (${disabledReason}). Set ANTHROPIC_API_KEY and/or OPENAI_API_KEY in .env to enable them; the built-in food list and recipes still work.`);
  }
  for (const name of names) {
    console.log(`AI provider "${name}" on (receipts: ${providers[name].models.receipt}, recipes: ${providers[name].models.recipes})`);
  }
});
