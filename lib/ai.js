import Anthropic from '@anthropic-ai/sdk';
import { RECEIPT_SCHEMA, RECEIPT_SYSTEM, RECIPE_SCHEMA, RECIPE_SYSTEM, receiptPrompt, recipePrompt } from './prompts.js';

// Anthropic (Claude) provider. Receipt parsing is short structured extraction,
// so it defaults to the cheapest current model; recipe writing to a stronger one.
const DEFAULT_RECEIPT_MODEL = 'claude-haiku-5-5';
const DEFAULT_RECIPE_MODEL = 'claude-opus-5-5';

/**
 * Returns { models, parseReceipt(text), suggestRecipes(items) }, or null when no
 * credentials are configured. Pass `client` to inject a fake in tests.
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

  async function askJson({ model, system, prompt, schema, effort }) {
    // If a safety classifier declines, re-run on Anthropic's recommended fallback model.
    // Haiku models have no server-side fallback, so don't ask for one there.
    const withFallback = !/haiku/i.test(model);

    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: prompt }],
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
        prompt: receiptPrompt(text),
        schema: RECEIPT_SCHEMA,
        effort: 'low',
      });
      return out.items;
    },

    async suggestRecipes(items) {
      const out = await askJson({
        model: recipeModel,
        system: RECIPE_SYSTEM,
        prompt: recipePrompt(items),
        schema: RECIPE_SCHEMA,
        effort: 'medium',
      });
      return out.recipes;
    },
  };
}
