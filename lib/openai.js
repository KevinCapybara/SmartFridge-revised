import OpenAI from 'openai';
import { RECEIPT_SCHEMA, RECEIPT_SYSTEM, RECIPE_SCHEMA, RECIPE_SYSTEM, receiptPrompt, recipePrompt } from './prompts.js';

// OpenAI (GPT) provider, same interface as the Claude one in ai.js.
// Defaults per OpenAI's model pricing page: gpt-6-luna is their most efficient
// model ($0.10 / $0.50 per 1M tokens, same price as Claude Haiku 5.5) and
// gpt-6.1-sol the mid tier ($2 / $10). Override with the env vars if prices change.
const DEFAULT_RECEIPT_MODEL = 'gpt-6-luna';
const DEFAULT_RECIPE_MODEL = 'gpt-6.1-sol';

/**
 * Returns { models, parseReceipt(text), suggestRecipes(items) }, or null when
 * OPENAI_API_KEY is not set. Pass `client` to inject a fake in tests.
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

  async function askJson({ model, system, prompt, schema, name, effort }) {
    const response = await client.responses.create({
      model,
      instructions: system,
      input: prompt,
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
        prompt: receiptPrompt(text),
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
        prompt: recipePrompt(items),
        schema: RECIPE_SCHEMA,
        name: 'recipes',
        effort: 'medium',
      });
      return out.recipes;
    },
  };
}
