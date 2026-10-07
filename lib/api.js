import { createHash, timingSafeEqual } from 'node:crypto';
import { MAX_DAYS } from '../public/shared/items.js';
import { sanitizeParsedItems, sanitizeRecipes } from './sanitize.js';

// The server's only job is the AI features; the fridge itself lives on the
// user's device. Each handler takes { method, headers, body } and returns
// { status, body }, so it runs unchanged under Vercel, Express, or a test.

const MAX_RECEIPT_CHARS = 20_000;
const MAX_RECIPE_ITEMS = 40;

const sha256 = (s) => createHash('sha256').update(String(s)).digest();
const sameSecret = (a, b) => timingSafeEqual(sha256(a), sha256(b));

const fail = (status, code, error) => ({ status, body: { error, code } });

/**
 * @param {object} config
 * @param {{ models: { receipt: string, recipes: string }, parseReceipt(text: string): Promise<unknown>, suggestRecipes(items: unknown[]): Promise<unknown> } | null} config.ai
 * @param {string} [config.accessCode]  when set, callers must send it as the x-access-code header
 * @param {string | null} [config.disabledReason]  why `ai` is null, reported by /api/health
 */
export function createApi({ ai = null, accessCode = '', disabledReason = null }) {
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
    if (!ai) return fail(503, 'ai_unavailable', 'AI features are not configured on the server');
    return null;
  }

  return {
    health({ method, headers }) {
      if (method !== 'GET') return fail(405, 'method_not_allowed', 'Use GET');
      const needsCode = Boolean(accessCode);
      return {
        status: 200,
        body: {
          ok: true,
          ai: Boolean(ai),
          needsCode,
          codeOk: needsCode ? codeFrom(headers) !== '' && sameSecret(codeFrom(headers), accessCode) : null,
          models: ai?.models ?? null,
          reason: ai ? null : disabledReason,
        },
      };
    },

    async parseReceipt(req) {
      const blocked = guard(req, 'POST');
      if (blocked) return blocked;

      const text = req.body?.text;
      if (typeof text !== 'string' || !text.trim()) return fail(400, 'bad_request', 'text is required');
      if (text.length > MAX_RECEIPT_CHARS) return fail(413, 'too_large', `Receipt text is limited to ${MAX_RECEIPT_CHARS} characters`);

      try {
        return { status: 200, body: { items: sanitizeParsedItems(await ai.parseReceipt(text)) } };
      } catch (err) {
        console.warn('AI receipt parsing failed:', err.message);
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
        const name = typeof it?.name === 'string' ? it.name.replace(/\s+/g, ' ').trim() : '';
        const daysLeft = Number(it?.daysLeft);
        if (!name || name.length > 80 || !Number.isInteger(daysLeft) || daysLeft < 0 || daysLeft > MAX_DAYS) {
          return fail(400, 'bad_request', 'Each item needs a name and a daysLeft between 0 and 3650');
        }
        items.push({ name, daysLeft });
      }

      try {
        const recipes = sanitizeRecipes(await ai.suggestRecipes(items));
        if (recipes.length === 0) return fail(502, 'ai_failed', 'The AI returned no recipes');
        return { status: 200, body: { recipes } };
      } catch (err) {
        console.warn('AI recipe generation failed:', err.message);
        return fail(502, 'ai_failed', 'The AI request failed');
      }
    },
  };
}
