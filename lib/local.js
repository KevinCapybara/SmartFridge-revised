import { normalizeWithFoodList } from '../public/shared/receipt.js';
import { RECEIPT_IMAGE_PROMPT, RECEIPT_SCHEMA, RECEIPT_SYSTEM, RECIPE_SCHEMA, RECIPE_SYSTEM, receiptPrompt, recipePrompt } from './prompts.js';

// Local open-source provider, served by Ollama (https://ollama.com): no API key,
// no cost, nothing leaves your machine. Same interface as ai.js / openai.js.
//
// Defaults are chosen for a CPU-only laptop:
//   receipts: qwen3-vl:2b-instruct (1.9 GB) - vision model with strong OCR; reads the photo directly
//   recipes:  qwen3:4b-instruct    (2.5 GB) - small text model
// The "-instruct" builds matter: the plain qwen3-vl:2b / qwen3:4b tags are *thinking* models that
// spend their whole token budget reasoning (Ollama's think:false does not stop them).
// Override with LOCAL_RECEIPT_MODEL / LOCAL_MODEL, e.g. qwen3-vl:4b-instruct for better accuracy.
//
// A 2B model reads receipts well but is weak at judgment (it won't expand "CHKN BRST" or
// estimate shelf life), so its receipt output is passed through the app's own food list
// (normalizeWithFoodList) for generic names, shelf lives and dropping household goods.
//
// Ollama must be reachable from wherever the server runs, so this provider works
// when the app runs on your computer (npm start), not on Vercel.

const DEFAULT_URL = 'http://127.0.0.1:11434';
const DEFAULT_RECEIPT_MODEL = 'qwen3-vl:2b-instruct';
const DEFAULT_RECIPE_MODEL = 'qwen3:4b-instruct';

const REQUEST_TIMEOUT_MS = 5 * 60_000; // CPU inference with an image can take minutes
const STATUS_TIMEOUT_MS = 1_500;
const STATUS_TTL_MS = 5_000;

// Small models follow a literal example better than a bare schema.
const RECEIPT_SHAPE = 'Reply with JSON only, in exactly this shape: {"items":[{"name":"milk","days":7}]}';
const RECIPE_SHAPE =
  'Reply with JSON only, in exactly this shape: {"recipes":[{"title":"Veggie omelette","time_minutes":10,"uses":["eggs"],"extras":["salt"],"steps":["Whisk the eggs.","Cook in a buttered pan."]}]}';

const sameModel = (installed, wanted) => installed === wanted || installed === `${wanted}:latest`;

/**
 * Returns { models, status(), parseReceipt(text), scanReceipt({ base64, mediaType }), suggestRecipes(items) },
 * or null when the local provider is switched off or can't apply (Vercel).
 * `fetchImpl` is injectable for tests.
 */
export function createLocal({
  env = process.env,
  fetchImpl = globalThis.fetch,
  receiptModel = env.LOCAL_RECEIPT_MODEL || DEFAULT_RECEIPT_MODEL,
  recipeModel = env.LOCAL_MODEL || DEFAULT_RECIPE_MODEL,
} = {}) {
  const url = (env.LOCAL_LLM_URL || DEFAULT_URL).replace(/\/+$/, '');
  if (/^(off|false|0)$/i.test(env.LOCAL_LLM_URL ?? '') || /^(off|false|0)$/i.test(env.LOCAL_LLM ?? '')) return null;
  // On Vercel there is no Ollama next to the function; only use it if a URL was set explicitly.
  if (env.VERCEL && !env.LOCAL_LLM_URL) return null;

  let cached = { at: 0, value: null };

  /** Is Ollama reachable, and are the models downloaded? Cached for a few seconds. */
  async function status() {
    if (cached.value && Date.now() - cached.at < STATUS_TTL_MS) return cached.value;
    let value;
    try {
      const res = await fetchImpl(`${url}/api/tags`, { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const names = ((await res.json()).models ?? []).map((m) => m.name);
      value = {
        reachable: true,
        ready: {
          receipt: names.some((n) => sameModel(n, receiptModel)),
          recipes: names.some((n) => sameModel(n, recipeModel)),
        },
      };
    } catch {
      value = { reachable: false, ready: { receipt: false, recipes: false } };
    }
    cached = { at: Date.now(), value };
    return value;
  }

  async function chat({ model, system, shape, user, images, schema }) {
    const res = await fetchImpl(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        stream: false,
        think: false, // reasoning tokens are slow on CPU and not needed for extraction
        keep_alive: '30m', // keep the model in RAM between requests
        messages: [
          { role: 'system', content: `${system}\n\n${shape}` },
          { role: 'user', content: user, ...(images && { images }) },
        ],
        format: schema, // constrains the output to the JSON schema
        options: { temperature: 0, num_ctx: 8192, num_predict: 2048 },
      }),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`Ollama returned ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    const data = await res.json();
    if (data.done_reason === 'length') throw new Error('The model response was cut off');
    const text = data.message?.content;
    if (!text) throw new Error('The model returned no text');
    return JSON.parse(text);
  }

  return {
    models: { receipt: receiptModel, recipes: recipeModel },
    status,

    async parseReceipt(text) {
      const out = await chat({ model: receiptModel, system: RECEIPT_SYSTEM, shape: RECEIPT_SHAPE, user: receiptPrompt(text), schema: RECEIPT_SCHEMA });
      return normalizeWithFoodList(out.items);
    },

    /** Read a receipt photo with the local vision model. `base64` has no data-URL prefix. */
    async scanReceipt({ base64 }) {
      const out = await chat({
        model: receiptModel,
        system: RECEIPT_SYSTEM,
        shape: RECEIPT_SHAPE,
        user: RECEIPT_IMAGE_PROMPT,
        images: [base64],
        schema: RECEIPT_SCHEMA,
      });
      return normalizeWithFoodList(out.items);
    },

    async suggestRecipes(items) {
      const out = await chat({ model: recipeModel, system: RECIPE_SYSTEM, shape: RECIPE_SHAPE, user: recipePrompt(items), schema: RECIPE_SCHEMA });
      return out.recipes;
    },
  };
}
