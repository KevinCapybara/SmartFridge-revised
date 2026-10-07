import Anthropic from '@anthropic-ai/sdk';
import {
  RECEIPT_IMAGE_PROMPT,
  RECEIPT_SCHEMA,
  RECEIPT_SYSTEM,
  RECIPE_SCHEMA,
  RECIPE_SYSTEM,
  receiptPrompt,
  recipePrompt,
} from './prompts.js';

// Anthropic (Claude) provider. Both jobs are short and structured, so both
// default to the fastest, cheapest current model (Haiku) at low effort.
// Set ANTHROPIC_MODEL=claude-sonnet-5-5 (or opus) for higher-quality recipes.
const DEFAULT_RECEIPT_MODEL = 'claude-haiku-5-5';
const DEFAULT_RECIPE_MODEL = 'claude-haiku-5-5';

/**
 * Returns { models, parseReceipt(text), scanReceipt({ base64, mediaType }), suggestRecipes(items) },
 * or null when no credentials are configured. Pass `client` to inject a fake in tests.
 */
export function createAi({
  client,
  env = process.env,
  receiptModel = env.ANTHROPIC_RECEIPT_MODEL || DEFAULT_RECEIPT_MODEL,
  recipeModel = env.ANTHROPIC_MODEL || DEFAULT_RECIPE_MODEL,
} = {}) {
  if (!client) {
    if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) return null;
    client = new Anthropic();
  }

  /** `content` is a string or an array of content blocks (for images). */
  async function askJson({ model, system, content, schema, effort }) {
    // If a safety classifier declines, re-run on Anthropic's recommended fallback model.
    // Haiku models have no server-side fallback, so don't ask for one there.
    const withFallback = !/haiku/i.test(model);

    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content }],
      output_config: { effort, format: { type: 'json_schema', schema } },
      ...(withFallback && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
    });

    if (response.stop_reason === 'refusal') throw new Error('The model declined this request');
    if (response.stop_reason === 'max_tokens') throw new Error('The model response was cut off');

    const text = response.content.find((b) => b.type === 'text')?.text;
    if (!text) throw new Error('The model returned no text');
    return JSON.parse(text);
  }

  return {
    models: { receipt: receiptModel, recipes: recipeModel },

    async parseReceipt(text) {
      const out = await askJson({
        model: receiptModel,
        system: RECEIPT_SYSTEM,
        content: receiptPrompt(text),
        schema: RECEIPT_SCHEMA,
        effort: 'low',
      });
      return out.items;
    },

    /** Read a receipt photo directly with the model's vision. `base64` has no data-URL prefix. */
    async scanReceipt({ base64, mediaType }) {
      const out = await askJson({
        model: receiptModel,
        system: RECEIPT_SYSTEM,
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: RECEIPT_IMAGE_PROMPT },
        ],
        schema: RECEIPT_SCHEMA,
        effort: 'low',
      });
      return out.items;
    },

    async suggestRecipes(items) {
      const out = await askJson({
        model: recipeModel,
        system: RECIPE_SYSTEM,
        content: recipePrompt(items),
        schema: RECIPE_SCHEMA,
        effort: 'low',
      });
      return out.recipes;
    },
  };
}
