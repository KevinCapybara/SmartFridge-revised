import { createHash, timingSafeEqual } from 'node:crypto';
import { MAX_DAYS } from '../public/shared/items.js';
import { IMAGE_TYPES } from './prompts.js';
import { sanitizeParsedItems, sanitizeRecipes } from './sanitize.js';

// The server's only job is the AI features; the fridge itself lives on the
// user's device. Each handler takes { method, headers, body } and returns
// { status, body }, so it runs unchanged under Vercel, Express, or a test.

const MAX_RECEIPT_CHARS = 20_000;
const MAX_RECIPE_ITEMS = 40;
// Vercel rejects request bodies over 4.5 MB; base64 is ~4/3 the raw size, so ~3 MB of image.
export const MAX_IMAGE_BASE64_CHARS = 4_000_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Providers the app knows about, in the order used when the caller doesn't choose. */
export const PROVIDER_NAMES = ['anthropic', 'openai', 'local'];

const sha256 = (s) => createHash('sha256').update(String(s)).digest();
const sameSecret = (a, b) => timingSafeEqual(sha256(a), sha256(b));

const fail = (status, code, error) => ({ status, body: { error, code } });

/**
 * @typedef {{ models: { receipt: string, recipes: string },
 *             status?: () => Promise<{ reachable: boolean, ready: { receipt: boolean, recipes: boolean } }>,
 *             parseReceipt(text: string): Promise<unknown>,
 *             scanReceipt(image: { base64: string, mediaType: string }): Promise<unknown>,
 *             suggestRecipes(items: unknown[]): Promise<unknown>}} Provider
 *
 * A provider with a `status()` (the local Ollama one) is probed on every request and is
 * only offered while it is reachable; others are assumed ready.
 *
 * @param {object} config
 * @param {Partial<Record<'anthropic' | 'openai' | 'local', Provider>>} [config.providers]  the configured AI providers
 * @param {string} [config.accessCode]  when set, callers must send it as the x-access-code header
 * @param {string | null} [config.disabledReason]  why no providers are on, reported by /api/health
 */
export function createApi({ providers = {}, accessCode = '', disabledReason = null }) {
  const configured = PROVIDER_NAMES.filter((name) => providers[name]);

  /** Providers that can serve a request right now, with which models are ready. */
  async function live() {
    const entries = await Promise.all(
      configured.map(async (name) => {
        const status = providers[name].status ? await providers[name].status() : { reachable: true, ready: { receipt: true, recipes: true } };
        return status.reachable ? [name, status.ready] : null;
      }),
    );
    return new Map(entries.filter(Boolean));
  }

  const codeFrom = (headers) => {
    const v = headers?.['x-access-code'];
    return typeof v === 'string' ? v : '';
  };

  /** Returns an error response, or null when the caller may proceed. */
  function checkAccess(headers) {
    if (!accessCode) return null;
    const given = codeFrom(headers);
    if (!given) return fail(401, 'access_code_required', 'Enter the access code in Settings to use AI features');
    if (!sameSecret(given, accessCode)) return fail(401, 'access_code_invalid', 'That access code is not correct');
    return null;
  }

  function guard({ method, headers }, allowed) {
    if (method !== allowed) return fail(405, 'method_not_allowed', `Use ${allowed}`);
    const denied = checkAccess(headers);
    if (denied) return denied;
    if (configured.length === 0) return fail(503, 'ai_unavailable', 'AI features are not configured on the server');
    return null;
  }

  /**
   * The provider for `feature` ('receipt' | 'recipes'): the one the caller asked for, or the
   * first ready one. Returns { name, provider } or { error }.
   */
  async function chooseProvider(requested, feature) {
    const ready = await live();
    const asked = requested !== undefined && requested !== null && requested !== '';

    if (asked && !PROVIDER_NAMES.includes(requested)) {
      return { error: fail(400, 'bad_request', `provider must be one of: ${PROVIDER_NAMES.join(', ')}`) };
    }
    const name = asked ? requested : [...ready.keys()].find((n) => ready.get(n)[feature]);

    if (!name) return { error: fail(503, 'ai_unavailable', 'No AI provider is available right now') };
    if (!ready.has(name)) return { error: fail(400, 'provider_unavailable', `The ${name} provider is not available on the server`) };
    if (!ready.get(name)[feature]) {
      const model = providers[name].models[feature];
      return { error: fail(400, 'model_not_ready', `The ${name} model "${model}" is not downloaded yet. Run: ollama pull ${model}`) };
    }
    return { name, provider: providers[name] };
  }

  return {
    async health({ method, headers }) {
      if (method !== 'GET') return fail(405, 'method_not_allowed', 'Use GET');
      const ready = await live();
      const needsCode = Boolean(accessCode);
      const availableNames = [...ready.keys()];
      return {
        status: 200,
        body: {
          ok: true,
          ai: availableNames.length > 0,
          needsCode,
          codeOk: needsCode ? codeFrom(headers) !== '' && sameSecret(codeFrom(headers), accessCode) : null,
          providers: Object.fromEntries(availableNames.map((name) => [name, { models: providers[name].models, ready: ready.get(name) }])),
          defaultProvider: availableNames[0] ?? null,
          reason: availableNames.length ? null : disabledReason,
        },
      };
    },

    async parseReceipt(req) {
      const blocked = guard(req, 'POST');
      if (blocked) return blocked;

      const text = req.body?.text;
      if (typeof text !== 'string' || !text.trim()) return fail(400, 'bad_request', 'text is required');
      if (text.length > MAX_RECEIPT_CHARS) return fail(413, 'too_large', `Receipt text is limited to ${MAX_RECEIPT_CHARS} characters`);

      const { name, provider, error } = await chooseProvider(req.body?.provider, 'receipt');
      if (error) return error;

      try {
        const items = sanitizeParsedItems(await provider.parseReceipt(text));
        return { status: 200, body: { items, provider: name, model: provider.models.receipt } };
      } catch (err) {
        console.warn(`AI receipt parsing failed (${name}):`, err.message);
        return fail(502, 'ai_failed', 'The AI request failed');
      }
    },

    // Read a receipt photo directly with the model's vision (the app downsizes it first).
    async scanReceipt(req) {
      const blocked = guard(req, 'POST');
      if (blocked) return blocked;

      const { image, mediaType } = req.body ?? {};
      if (typeof image !== 'string' || !image) return fail(400, 'bad_request', 'image is required (base64)');
      if (!IMAGE_TYPES.includes(mediaType)) return fail(400, 'bad_request', `mediaType must be one of: ${IMAGE_TYPES.join(', ')}`);
      if (image.length > MAX_IMAGE_BASE64_CHARS) return fail(413, 'too_large', 'That image is too large - try a smaller photo');
      if (!BASE64.test(image)) return fail(400, 'bad_request', 'image must be plain base64 without a data: prefix');

      const { name, provider, error } = await chooseProvider(req.body?.provider, 'receipt');
      if (error) return error;

      try {
        const items = sanitizeParsedItems(await provider.scanReceipt({ base64: image, mediaType }));
        return { status: 200, body: { items, provider: name, model: provider.models.receipt } };
      } catch (err) {
        console.warn(`AI receipt scan failed (${name}):`, err.message);
        return fail(502, 'ai_failed', 'The AI request failed');
      }
    },

    async recipes(req) {
      const blocked = guard(req, 'POST');
      if (blocked) return blocked;

      const raw = req.body?.items;
      if (!Array.isArray(raw) || raw.length === 0) return fail(400, 'bad_request', 'items must be a non-empty array');
      if (raw.length > MAX_RECIPE_ITEMS) return fail(400, 'bad_request', `At most ${MAX_RECIPE_ITEMS} items`);

      const items = [];
      for (const it of raw) {
        const itemName = typeof it?.name === 'string' ? it.name.replace(/\s+/g, ' ').trim() : '';
        const daysLeft = Number(it?.daysLeft);
        if (!itemName || itemName.length > 80 || !Number.isInteger(daysLeft) || daysLeft < 0 || daysLeft > MAX_DAYS) {
          return fail(400, 'bad_request', 'Each item needs a name and a daysLeft between 0 and 3650');
        }
        items.push({ name: itemName, daysLeft });
      }

      const { name, provider, error } = await chooseProvider(req.body?.provider, 'recipes');
      if (error) return error;

      try {
        const recipes = sanitizeRecipes(await provider.suggestRecipes(items));
        if (recipes.length === 0) return fail(502, 'ai_failed', 'The AI returned no recipes');
        return { status: 200, body: { recipes, provider: name, model: provider.models.recipes } };
      } catch (err) {
        console.warn(`AI recipe generation failed (${name}):`, err.message);
        return fail(502, 'ai_failed', 'The AI request failed');
      }
    },
  };
}
