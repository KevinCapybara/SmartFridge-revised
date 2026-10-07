import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, MAX_IMAGE_BASE64_CHARS } from '../lib/api.js';
import { createAi } from '../lib/ai.js';
import { createOpenAi } from '../lib/openai.js';
import { resolveConfig } from '../lib/runtime.js';
import { sanitizeParsedItems, sanitizeRecipes } from '../lib/sanitize.js';

const fakeProvider = (tag, overrides = {}) => ({
  models: { receipt: `${tag}-receipt-model`, recipes: `${tag}-recipe-model` },
  parseReceipt: async () => [
    { name: ' Milk ', days: 7.4 },
    { name: 'milk', days: 3 }, // duplicate after normalising
    { name: 'eggs', days: 99999 }, // clamped
    { name: 'broken', days: 'soon' }, // dropped
    { days: 5 }, // dropped
  ],
  scanReceipt: async () => [{ name: 'Bananas', days: 5 }],
  suggestRecipes: async () => [{ title: ' Omelette ', time_minutes: 10, uses: ['eggs'], extras: ['salt'], steps: ['Whisk', 'Cook'] }, { title: '' }],
  ...overrides,
});

const post = (body, headers = {}) => ({ method: 'POST', headers, body });
const one = (overrides) => ({ anthropic: fakeProvider('claude', overrides) });

test('health reports providers and never leaks the access code', () => {
  const off = createApi({ providers: {}, disabledReason: 'no_api_key' }).health({ method: 'GET', headers: {} });
  assert.deepEqual(off.body, { ok: true, ai: false, needsCode: false, codeOk: null, providers: {}, defaultProvider: null, reason: 'no_api_key' });

  const both = createApi({ providers: { openai: fakeProvider('gpt'), anthropic: fakeProvider('claude') } }).health({ method: 'GET', headers: {} });
  assert.deepEqual(Object.keys(both.body.providers), ['anthropic', 'openai']); // fixed order
  assert.equal(both.body.defaultProvider, 'anthropic');
  assert.deepEqual(both.body.providers.openai.models, { receipt: 'gpt-receipt-model', recipes: 'gpt-recipe-model' });

  const onlyOpenAi = createApi({ providers: { openai: fakeProvider('gpt') } }).health({ method: 'GET', headers: {} });
  assert.equal(onlyOpenAi.body.defaultProvider, 'openai');

  const api = createApi({ providers: one(), accessCode: 'sesame' });
  assert.equal(api.health({ method: 'GET', headers: {} }).body.codeOk, false);
  assert.equal(api.health({ method: 'GET', headers: { 'x-access-code': 'nope' } }).body.codeOk, false);
  const ok = api.health({ method: 'GET', headers: { 'x-access-code': 'sesame' } });
  assert.equal(ok.body.codeOk, true);
  assert.ok(!JSON.stringify(ok.body).includes('sesame'));
  assert.equal(api.health({ method: 'POST', headers: {} }).status, 405);
});

test('access code gate: missing, wrong, and right codes', async () => {
  const api = createApi({ providers: one(), accessCode: 'sesame' });
  const body = { text: 'MILK 3.99' };

  const missing = await api.parseReceipt(post(body));
  assert.equal(missing.status, 401);
  assert.equal(missing.body.code, 'access_code_required');

  const wrong = await api.parseReceipt(post(body, { 'x-access-code': 'open' }));
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.code, 'access_code_invalid');

  assert.equal((await api.parseReceipt(post(body, { 'x-access-code': 'sesame' }))).status, 200);
  assert.equal((await api.recipes(post({ items: [] }, { 'x-access-code': 'wrong' }))).status, 401);
});

test('parseReceipt: sanitises model output and validates input', async () => {
  const api = createApi({ providers: one() });
  const ok = await api.parseReceipt(post({ text: 'MILK 3.99\nEGGS 2.99' }));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.items, [
    { name: 'milk', days: 7 },
    { name: 'eggs', days: 3650 },
  ]);
  assert.equal(ok.body.provider, 'anthropic');
  assert.equal(ok.body.model, 'claude-receipt-model');

  assert.equal((await api.parseReceipt(post({}))).status, 400);
  assert.equal((await api.parseReceipt(post({ text: '   ' }))).status, 400);
  assert.equal((await api.parseReceipt(post({ text: 'x'.repeat(20_001) }))).status, 413);
  assert.equal((await api.parseReceipt({ method: 'GET', headers: {}, body: undefined })).status, 405);
});

test('provider choice: caller picks per request, default otherwise, bad values rejected', async () => {
  const calls = [];
  const api = createApi({
    providers: {
      anthropic: fakeProvider('claude', { parseReceipt: async () => (calls.push('claude'), [{ name: 'milk', days: 7 }]) }),
      openai: fakeProvider('gpt', { parseReceipt: async () => (calls.push('gpt'), [{ name: 'milk', days: 7 }]) }),
    },
  });

  const viaGpt = await api.parseReceipt(post({ text: 'milk', provider: 'openai' }));
  assert.equal(viaGpt.status, 200);
  assert.deepEqual([viaGpt.body.provider, viaGpt.body.model], ['openai', 'gpt-receipt-model']);

  const viaDefault = await api.parseReceipt(post({ text: 'milk' }));
  assert.equal(viaDefault.body.provider, 'anthropic');
  assert.deepEqual(calls, ['gpt', 'claude']);

  assert.equal((await api.parseReceipt(post({ text: 'milk', provider: 'nonsense' }))).status, 400);
  assert.equal((await api.parseReceipt(post({ text: 'milk', provider: 42 }))).status, 400);

  // Asking for a provider the server doesn't have is a clear error, not a silent switch.
  const claudeOnly = createApi({ providers: one() });
  const missing = await claudeOnly.parseReceipt(post({ text: 'milk', provider: 'openai' }));
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, 'provider_unavailable');

  // Recipes choose independently.
  const recipe = await api.recipes(post({ items: [{ name: 'eggs', daysLeft: 1 }], provider: 'openai' }));
  assert.deepEqual([recipe.status, recipe.body.provider, recipe.body.model], [200, 'openai', 'gpt-recipe-model']);
});

test('scanReceipt: reads a photo, validates the upload, honours provider choice', async () => {
  const seen = [];
  const api = createApi({
    providers: {
      anthropic: fakeProvider('claude', { scanReceipt: async (img) => (seen.push(['claude', img.mediaType, img.base64]), [{ name: 'Bananas', days: 5 }]) }),
      openai: fakeProvider('gpt', { scanReceipt: async (img) => (seen.push(['gpt', img.mediaType, img.base64]), [{ name: 'Eggs', days: 28 }]) }),
    },
  });
  const jpeg = Buffer.from('fake jpeg bytes').toString('base64');

  const ok = await api.scanReceipt(post({ image: jpeg, mediaType: 'image/jpeg' }));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { items: [{ name: 'bananas', days: 5 }], provider: 'anthropic', model: 'claude-receipt-model' });

  const viaGpt = await api.scanReceipt(post({ image: jpeg, mediaType: 'image/png', provider: 'openai' }));
  assert.deepEqual([viaGpt.body.provider, viaGpt.body.items[0].name], ['openai', 'eggs']);
  assert.deepEqual(seen, [['claude', 'image/jpeg', jpeg], ['gpt', 'image/png', jpeg]]);

  const bad = [
    {}, // no image
    { image: jpeg }, // no type
    { image: jpeg, mediaType: 'image/gif' }, // unsupported type
    { image: `data:image/jpeg;base64,${jpeg}`, mediaType: 'image/jpeg' }, // data: prefix not allowed
    { image: 'not base64!!', mediaType: 'image/jpeg' },
    { image: 123, mediaType: 'image/jpeg' },
  ];
  for (const body of bad) assert.equal((await api.scanReceipt(post(body))).status, 400, JSON.stringify(body).slice(0, 60));

  const huge = await api.scanReceipt(post({ image: 'A'.repeat(MAX_IMAGE_BASE64_CHARS + 1), mediaType: 'image/jpeg' }));
  assert.equal(huge.status, 413);

  assert.equal((await api.scanReceipt({ method: 'GET', headers: {}, body: {} })).status, 405);
  const gated = createApi({ providers: one(), accessCode: 'sesame' });
  assert.equal((await gated.scanReceipt(post({ image: jpeg, mediaType: 'image/jpeg' }))).status, 401);
  assert.equal((await createApi({ providers: {} }).scanReceipt(post({ image: jpeg, mediaType: 'image/jpeg' }))).status, 503);

  const failing = createApi({ providers: one({ scanReceipt: async () => { throw new Error('vision boom'); } }) });
  const res = await failing.scanReceipt(post({ image: jpeg, mediaType: 'image/jpeg' }));
  assert.equal(res.status, 502);
  assert.ok(!JSON.stringify(res.body).includes('vision boom'));
});

test('parseReceipt: 503 without AI, 502 when the model call fails', async () => {
  assert.equal((await createApi({ providers: {} }).parseReceipt(post({ text: 'milk' }))).status, 503);
  const failing = createApi({ providers: one({ parseReceipt: async () => { throw new Error('boom'); } }) });
  const res = await failing.parseReceipt(post({ text: 'milk' }));
  assert.equal(res.status, 502);
  assert.ok(!JSON.stringify(res.body).includes('boom')); // internal error text is not leaked
});

test('recipes: validates items, sanitises output', async () => {
  const api = createApi({ providers: one() });
  const good = await api.recipes(post({ items: [{ name: 'eggs', daysLeft: 1 }] }));
  assert.equal(good.status, 200);
  assert.deepEqual(good.body.recipes, [{ title: 'Omelette', time_minutes: 10, uses: ['eggs'], extras: ['salt'], steps: ['Whisk', 'Cook'] }]);

  for (const items of [undefined, [], 'eggs', [{ name: 'eggs' }], [{ name: 'eggs', daysLeft: -1 }], [{ name: '', daysLeft: 1 }], [{ name: 'eggs', daysLeft: 1.5 }]]) {
    assert.equal((await api.recipes(post({ items }))).status, 400, JSON.stringify(items));
  }
  const tooMany = Array.from({ length: 41 }, (_, i) => ({ name: `item ${i}`, daysLeft: 1 }));
  assert.equal((await api.recipes(post({ items: tooMany }))).status, 400);

  const empty = createApi({ providers: one({ suggestRecipes: async () => [] }) });
  assert.equal((await empty.recipes(post({ items: [{ name: 'eggs', daysLeft: 1 }] }))).status, 502);
});

test('sanitize helpers cope with garbage', () => {
  assert.deepEqual(sanitizeParsedItems(null), []);
  assert.deepEqual(sanitizeParsedItems('x'), []);
  assert.deepEqual(sanitizeRecipes({ not: 'an array' }), []);
  assert.equal(sanitizeRecipes([{ title: 'T', time_minutes: 'later', uses: 'eggs', steps: [1, 'ok', ' '] }])[0].time_minutes, null);
  assert.deepEqual(sanitizeRecipes([{ title: 'T', steps: [1, 'ok', ' '] }])[0].steps, ['ok']);
});

test('resolveConfig: key handling, including the Vercel safety rule', () => {
  assert.equal(resolveConfig({}).disabledReason, 'no_api_key');
  assert.deepEqual(resolveConfig({}).providers, {});

  // Public deployment with a key but no access code: refuse to use any key.
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
    const exposed = resolveConfig({ [key]: 'sk-test', VERCEL: '1' });
    assert.deepEqual(exposed.providers, {});
    assert.equal(exposed.disabledReason, 'access_code_required');
  }

  const locked = resolveConfig({ ANTHROPIC_API_KEY: 'sk-ant-test', OPENAI_API_KEY: 'sk-test', VERCEL: '1', APP_ACCESS_CODE: 'sesame' });
  assert.deepEqual(Object.keys(locked.providers), ['anthropic', 'openai']);
  assert.equal(locked.accessCode, 'sesame');

  // Local dev works without a code, and each key enables only its own provider.
  assert.deepEqual(Object.keys(resolveConfig({ ANTHROPIC_API_KEY: 'sk-ant-test' }).providers), ['anthropic']);
  assert.deepEqual(Object.keys(resolveConfig({ OPENAI_API_KEY: 'sk-test' }).providers), ['openai']);
});

// ---- Anthropic request shape -----------------------------------------------

function fakeClient(responseText, extra = {}) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: responseText }], ...extra };
        },
      },
    },
  };
}

test('createAi (Claude): null without credentials, correct requests with a client', async () => {
  assert.equal(createAi({ env: {} }), null);

  const client = fakeClient(JSON.stringify({ items: [{ name: 'milk', days: 7 }] }));
  const ai = createAi({ client, env: {} });
  assert.deepEqual(ai.models, { receipt: 'claude-haiku-5-5', recipes: 'claude-haiku-5-5' }); // fastest tier for both
  assert.deepEqual(await ai.parseReceipt('MILK 3.99'), [{ name: 'milk', days: 7 }]);

  const req = client.calls[0];
  assert.equal(req.model, 'claude-haiku-5-5'); // cheapest model for receipt parsing
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(req.output_config.effort, 'low');
  assert.equal(req.fallbacks, undefined); // Haiku has no server-side refusal fallback
  assert.equal(req.betas, undefined);
  assert.equal(req.thinking, undefined);
  assert.equal(req.temperature, undefined); // non-default sampling params are rejected
  assert.ok(req.messages[0].content.includes('<receipt>') && req.messages[0].content.includes('MILK 3.99'));
});

test('createAi (Claude): models can be overridden, and fallback is requested only for non-Haiku models', async () => {
  const client = fakeClient(JSON.stringify({ recipes: [] }));
  const ai = createAi({ client, env: { ANTHROPIC_RECEIPT_MODEL: 'claude-sonnet-5-5', ANTHROPIC_MODEL: 'claude-haiku-5-5' } });
  assert.deepEqual(ai.models, { receipt: 'claude-sonnet-5-5', recipes: 'claude-haiku-5-5' });

  await ai.suggestRecipes([{ name: 'eggs', daysLeft: 1 }]);
  assert.equal(client.calls[0].model, 'claude-haiku-5-5');
  assert.equal(client.calls[0].fallbacks, undefined);

  const sonnet = fakeClient(JSON.stringify({ recipes: [] }));
  await createAi({ client: sonnet, env: { ANTHROPIC_MODEL: 'claude-sonnet-5-5' } }).suggestRecipes([{ name: 'eggs', daysLeft: 1 }]);
  assert.equal(sonnet.calls[0].model, 'claude-sonnet-5-5');
  assert.equal(sonnet.calls[0].fallbacks, 'default');
  assert.deepEqual(sonnet.calls[0].betas, ['server-side-fallback-2026-07-01']);
});

test('createAi (Claude): scanReceipt sends the photo as an image block', async () => {
  const client = fakeClient(JSON.stringify({ items: [{ name: 'milk', days: 7 }] }));
  const items = await createAi({ client, env: {} }).scanReceipt({ base64: 'QUJD', mediaType: 'image/jpeg' });
  assert.deepEqual(items, [{ name: 'milk', days: 7 }]);

  const req = client.calls[0];
  assert.equal(req.model, 'claude-haiku-5-5');
  assert.equal(req.output_config.effort, 'low');
  const [image, text] = req.messages[0].content;
  assert.deepEqual(image, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } });
  assert.equal(text.type, 'text');
  assert.ok(req.system.includes('photo'));
});

test('createAi (Claude): refusals, truncation and empty responses throw', async () => {
  const refused = createAi({ client: fakeClient('', { stop_reason: 'refusal' }), env: {} });
  await assert.rejects(refused.parseReceipt('x'), /declined/);
  const cut = createAi({ client: fakeClient('{"items":[', { stop_reason: 'max_tokens' }), env: {} });
  await assert.rejects(cut.parseReceipt('x'), /cut off/);
  const none = createAi({ client: { beta: { messages: { create: async () => ({ stop_reason: 'end_turn', content: [] }) } } }, env: {} });
  await assert.rejects(none.parseReceipt('x'), /no text/);
});

test('createAi (Claude): recipe prompt lists items with days left', async () => {
  const client = fakeClient(JSON.stringify({ recipes: [] }));
  await createAi({ client, env: {} }).suggestRecipes([{ name: 'eggs', daysLeft: 1 }, { name: 'milk', daysLeft: 0 }]);
  const prompt = client.calls[0].messages[0].content;
  assert.ok(prompt.includes('eggs: expires in 1 day\n'));
  assert.ok(prompt.includes('milk: expires in 0 days'));
  assert.equal(client.calls[0].output_config.effort, 'low'); // lowest latency
});

// ---- OpenAI request shape --------------------------------------------------

function fakeOpenAiClient(response) {
  const calls = [];
  return { calls, responses: { create: async (params) => (calls.push(params), response) } };
}
const outputText = (text) => ({ status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text }] }] });

test('createOpenAi: null without a key, cheap default for receipts, strict JSON schema request', async () => {
  assert.equal(createOpenAi({ env: {} }), null);

  const client = fakeOpenAiClient(outputText(JSON.stringify({ items: [{ name: 'milk', days: 7 }] })));
  const gpt = createOpenAi({ client, env: {} });
  assert.deepEqual(gpt.models, { receipt: 'gpt-6-luna', recipes: 'gpt-6-luna' }); // fastest tier for both
  assert.deepEqual(await gpt.parseReceipt('MILK 3.99'), [{ name: 'milk', days: 7 }]);

  const req = client.calls[0];
  assert.equal(req.model, 'gpt-6-luna');
  assert.equal(req.text.format.type, 'json_schema');
  assert.equal(req.text.format.strict, true);
  assert.equal(req.text.format.name, 'receipt_items');
  assert.equal(req.reasoning.effort, 'low');
  assert.equal(req.store, false); // receipts are not retained by OpenAI
  assert.equal(req.temperature, undefined);
  assert.ok(req.instructions.includes('grocery-store receipts'));
  assert.ok(req.input.includes('<receipt>') && req.input.includes('MILK 3.99'));
});

test('createOpenAi: env overrides, recipes use the stronger model, errors throw', async () => {
  const client = fakeOpenAiClient(outputText(JSON.stringify({ recipes: [] })));
  const gpt = createOpenAi({ client, env: { OPENAI_RECEIPT_MODEL: 'gpt-5-nano', OPENAI_MODEL: 'gpt-6-astra' } });
  assert.deepEqual(gpt.models, { receipt: 'gpt-5-nano', recipes: 'gpt-6-astra' });
  await gpt.suggestRecipes([{ name: 'eggs', daysLeft: 1 }]);
  assert.equal(client.calls[0].model, 'gpt-6-astra');
  assert.equal(client.calls[0].reasoning.effort, 'low');
  assert.ok(client.calls[0].input.includes('eggs: expires in 1 day'));

  const vision = fakeOpenAiClient(outputText(JSON.stringify({ items: [{ name: 'eggs', days: 28 }] })));
  const scanned = await createOpenAi({ client: vision, env: {} }).scanReceipt({ base64: 'QUJD', mediaType: 'image/png' });
  assert.deepEqual(scanned, [{ name: 'eggs', days: 28 }]);
  const [message] = vision.calls[0].input;
  assert.equal(message.role, 'user');
  assert.deepEqual(message.content[1], { type: 'input_image', image_url: 'data:image/png;base64,QUJD', detail: 'high' });
  assert.equal(vision.calls[0].store, false);

  const refusal = createOpenAi({ client: fakeOpenAiClient({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }), env: {} });
  await assert.rejects(refusal.parseReceipt('x'), /declined/);
  const cut = createOpenAi({ client: fakeOpenAiClient({ status: 'incomplete', output: [] }), env: {} });
  await assert.rejects(cut.parseReceipt('x'), /cut off/);
  const none = createOpenAi({ client: fakeOpenAiClient({ status: 'completed', output: [] }), env: {} });
  await assert.rejects(none.parseReceipt('x'), /no text/);
});
