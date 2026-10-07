import { createApi } from './api.js';
import { createAi } from './ai.js';
import { createLocal } from './local.js';
import { createOpenAi } from './openai.js';

/**
 * Decide from the environment which AI providers are on.
 *
 * On Vercel the endpoints are public on the internet, so providers are only used
 * when APP_ACCESS_CODE is also set - otherwise anyone who found the URL could
 * spend your API credits (or your Ollama server's CPU).
 *
 * The local (Ollama) provider needs no key; it is configured unless switched off
 * with LOCAL_LLM=off, and is only offered while Ollama is actually reachable.
 */
export function resolveConfig(env = process.env) {
  const accessCode = env.APP_ACCESS_CODE ?? '';

  if (env.VERCEL && !accessCode) {
    const wouldBeOn = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.OPENAI_API_KEY || env.LOCAL_LLM_URL;
    return { providers: {}, accessCode, disabledReason: wouldBeOn ? 'access_code_required' : 'no_provider' };
  }

  const providers = {};
  const anthropic = createAi({ env });
  if (anthropic) providers.anthropic = anthropic;
  const openai = createOpenAi({ env });
  if (openai) providers.openai = openai;
  const local = createLocal({ env });
  if (local) providers.local = local;
  return { providers, accessCode, disabledReason: 'no_provider' };
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
