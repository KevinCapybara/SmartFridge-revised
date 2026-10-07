import { createApi } from './api.js';
import { createAi } from './ai.js';

/**
 * Decide from the environment whether AI is on.
 *
 * On Vercel the endpoints are public on the internet, so the API key is only
 * used when APP_ACCESS_CODE is also set - otherwise anyone who found the URL
 * could spend your credits.
 */
export function resolveConfig(env = process.env) {
  const accessCode = env.APP_ACCESS_CODE ?? '';
  const hasKey = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);

  if (!hasKey) return { ai: null, accessCode, disabledReason: 'no_api_key' };
  if (env.VERCEL && !accessCode) return { ai: null, accessCode, disabledReason: 'access_code_required' };
  return { ai: createAi({ env }), accessCode, disabledReason: null };
}

let api;
export function getApi() {
  api ??= createApi(resolveConfig());
  return api;
}

/** Adapt a { method, headers, body } -> { status, body } function to a Node/Vercel/Express (req, res) handler. */
export function toNodeHandler(fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const out = await fn({ method: req.method, headers: req.headers, body: req.body });
      res.status(out.status).json(out.body);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal error', code: 'internal' });
    }
  };
}
