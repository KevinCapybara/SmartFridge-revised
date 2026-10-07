import OpenAI from 'openai';
import {
  RECEIPT_IMAGE_PROMPT,
  RECEIPT_SCHEMA,
  RECEIPT_SYSTEM,
  RECIPE_SCHEMA,
  RECIPE_SYSTEM,
  receiptPrompt,
  recipePrompt,
} from './prompts.js';

// OpenAI (GPT) provider, same interface as the Claude one in ai.js.
// Both jobs default to gpt-6-luna, which OpenAI describes as its most efficient
// model for focused, high-volume tasks ($0.10 / $0.50 per 1M tokens, per their
// pricing page). Set OPENAI_MODEL=gpt-6.1-sol for higher-quality recipes.
const DEFAULT_RECEIPT_MODEL = 'gpt-6-luna';
const DEFAULT_RECIPE_MODEL = 'gpt-6-luna';

/**
 * Returns { models, parseReceipt(text), scanReceipt({ base64, mediaType }), suggestRecipes(items) },
 * or null when OPENAI_API_KEY is not set. Pass `client` to inject a fake in tests.
 */
export function createOpenAi({
  client,
  env = process.env,
  receiptModel = env.OPENAI_RECEIPT_MODEL || DEFAULT_RECEIPT_MODEL,
  recipeModel = env.OPENAI_MODEL || DEFAULT_RECIPE_MODEL,
} = {}) {
  if (!client) {
    if (!env.OPENAI_API_KEY) return null;
    client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  /** `input` is a string or an array of Responses API input messages (for images). */
  async function askJson({ model, system, input, schema, name, effort }) {
    const response = await client.responses.create({
      model,
      instructions: system,
      input,
      reasoning: { effort },
      max_output_tokens: 16000,
      text: { format: { type: 'json_schema', name, schema, strict: true } },
      store: false, // don't keep receipts / fridge contents on OpenAI's servers
    });

    if (response.status === 'incomplete') throw new Error('The model response was cut off');

    let text = '';
    for (const item of response.output ?? []) {
      if (item.type !== 'message') continue;
      for (const part of item.content ?? []) {
        if (part.type === 'refusal') throw new Error('The model declined this request');
        if (part.type === 'output_text') text += part.text;
      }
    }
    if (!text) throw new Error('The model returned no text');
    return JSON.parse(text);
  }

  return {
    models: { receipt: receiptModel, recipes: recipeModel },

    async parseReceipt(text) {
      const out = await askJson({
        model: receiptModel,
        system: RECEIPT_SYSTEM,
        input: receiptPrompt(text),
        schema: RECEIPT_SCHEMA,
        name: 'receipt_items',
        effort: 'low',
      });
      return out.items;
    },

    /** Read a receipt photo directly with the model's vision. `base64` has no data-URL prefix. */
    async scanReceipt({ base64, mediaType }) {
      const out = await askJson({
        model: receiptModel,
        system: RECEIPT_SYSTEM,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: RECEIPT_IMAGE_PROMPT },
              // "high" so small receipt print stays legible.
              { type: 'input_image', image_url: `data:${mediaType};base64,${base64}`, detail: 'high' },
            ],
          },
        ],
        schema: RECEIPT_SCHEMA,
        name: 'receipt_items',
        effort: 'low',
      });
      return out.items;
    },

    async suggestRecipes(items) {
      const out = await askJson({
        model: recipeModel,
        system: RECIPE_SYSTEM,
        input: recipePrompt(items),
        schema: RECIPE_SCHEMA,
        name: 'recipes',
        effort: 'low',
      });
      return out.recipes;
    },
  };
}
