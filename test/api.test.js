import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, MAX_IMAGE_BASE64_CHARS } from '../lib/api.js';
import { createAi } from '../lib/ai.js';
import { createLocal } from '../lib/local.js';
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
const get = (headers = {}) => ({ method: 'GET', headers });
const one = (overrides) => ({ anthropic: fakeProvider('claude', overrides) });
const READY = { receipt: true, recipes: true };

test('health reports providers and never leaks the access code', async () => {
  const off = await createApi({ providers: {}, disabledReason: 'no_provider' }).health(get());
  assert.deepEqual(off.body, { ok: true, ai: false, needsCode: false, codeOk: null, providers: {}, defaultProvider: null, reason: 'no_provider' });

  const both = await createApi({ providers: { openai: fakeProvider('gpt'), anthropic: fakeProvider('claude') } }).health(get());
  assert.deepEqual(Object.keys(both.body.providers), ['anthropic', 'openai']); // fixed order
  assert.equal(both.body.defaultProvider, 'anthropic');
  assert.deepEqual(both.body.providers.openai, { models: { receipt: 'gpt-receipt-model', recipes: 'gpt-recipe-model' }, ready: READY });

  const onlyOpenAi = await createApi({ providers: { openai: fakeProvider('gpt') } }).health(get());
  assert.equal(onlyOpenAi.body.defaultProvider, 'openai');

  const api = createApi({ providers: one(), accessCode: 'sesame' });
  assert.equal((await api.health(get())).body.codeOk, false);
  assert.equal((await api.health(get({ 'x-access-code': 'nope' }))).body.codeOk, false);
  const ok = await api.health(get({ 'x-access-code': 'sesame' }));
  assert.equal(ok.body.codeOk, true);
  assert.ok(!JSON.stringify(ok.body).includes('sesame'));
  assert.equal((await api.health({ method: 'POST', headers: {} })).status, 405);
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

test('local provider: probed live, offered only while reachable, and per-model readiness is honoured', async () => {
  let state = { reachable: false, ready: { receipt: false, recipes: false } };
  const local = fakeProvider('ollama', { status: async () => state });
  const api = createApi({ providers: { local }, disabledReason: 'no_provider' });

  // Ollama not running: not offered, requests get 503.
  const down = await api.health(get());
  assert.deepEqual([down.body.ai, down.body.providers, down.body.defaultProvider], [false, {}, null]);
  assert.equal((await api.parseReceipt(post({ text: 'milk' }))).status, 503);
  assert.equal((await api.parseReceipt(post({ text: 'milk', provider: 'local' }))).body.code, 'provider_unavailable');

  // Running, but only the recipe model is downloaded.
  state = { reachable: true, ready: { receipt: false, recipes: true } };
  const partial = await api.health(get());
  assert.equal(partial.body.ai, true);
  assert.deepEqual(partial.body.providers.local.ready, { receipt: false, recipes: true });
  const notReady = await api.parseReceipt(post({ text: 'milk', provider: 'local' }));
  assert.equal(notReady.status, 400);
  assert.equal(notReady.body.code, 'model_not_ready');
  assert.ok(notReady.body.error.includes('ollama pull ollama-receipt-model'));
  assert.equal((await api.parseReceipt(post({ text: 'milk' }))).status, 503); // default skips providers whose model isn't ready
  assert.equal((await api.recipes(post({ items: [{ name: 'eggs', daysLeft: 1 }] }))).status, 200);

  // Everything downloaded: used as the default when it is the only provider.
  state = { reachable: true, ready: READY };
  const ok = await api.parseReceipt(post({ text: 'milk' }));
  assert.deepEqual([ok.status, ok.body.provider], [200, 'local']);
});

test('default provider skips a local model that is not ready in favour of a ready cloud one', async () => {
  const api = createApi({
    providers: {
      anthropic: fakeProvider('claude'),
      local: fakeProvider('ollama', { status: async () => ({ reachable: true, ready: { receipt: true, recipes: true } }) }),
    },
  });
  assert.equal((await api.parseReceipt(post({ text: 'milk' }))).body.provider, 'anthropic'); // order: anthropic first
  assert.equal((await api.parseReceipt(post({ text: 'milk', provider: 'local' }))).body.provider, 'local');
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

test('resolveConfig: providers from the environment, including the Vercel safety rule', () => {
  const off = { LOCAL_LLM: 'off' };

  assert.equal(resolveConfig(off).disabledReason, 'no_provider');
  assert.deepEqual(resolveConfig(off).providers, {});

  // Public deployment with a key but no access code: refuse to use any key.
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
    const exposed = resolveConfig({ [key]: 'sk-test', VERCEL: '1' });
    assert.deepEqual(exposed.providers, {});
    assert.equal(exposed.disabledReason, 'access_code_required');
  }
  assert.equal(resolveConfig({ VERCEL: '1' }).disabledReason, 'no_provider'); // nothing to protect

  // On Vercel with a code: cloud providers on; local (Ollama) needs an explicit URL.
  const locked = resolveConfig({ ANTHROPIC_API_KEY: 'sk-ant-test', OPENAI_API_KEY: 'sk-test', VERCEL: '1', APP_ACCESS_CODE: 'sesame' });
  assert.deepEqual(Object.keys(locked.providers), ['anthropic', 'openai']);
  assert.equal(locked.accessCode, 'sesame');
  const remote = resolveConfig({ VERCEL: '1', APP_ACCESS_CODE: 'sesame', LOCAL_LLM_URL: 'https://ollama.example.com' });
  assert.deepEqual(Object.keys(remote.providers), ['local']);

  // Local dev: each key enables only its own provider; Ollama needs no key and is on by default.
  assert.deepEqual(Object.keys(resolveConfig({ ...off, ANTHROPIC_API_KEY: 'sk-ant-test' }).providers), ['anthropic']);
  assert.deepEqual(Object.keys(resolveConfig({ ...off, OPENAI_API_KEY: 'sk-test' }).providers), ['openai']);
  assert.deepEqual(Object.keys(resolveConfig({}).providers), ['local']);
  assert.deepEqual(Object.keys(resolveConfig({ ANTHROPIC_API_KEY: 'sk-ant-test', OPENAI_API_KEY: 'sk-test' }).providers), ['anthropic', 'openai', 'local']);
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

// ---- Local (Ollama) --------------------------------------------------------

/** A fake Ollama: records /api/chat bodies, serves /api/tags. */
function fakeOllama({ tags = ['qwen3-vl:2b-instruct', 'qwen3:4b-instruct'], chat } = {}) {
  const calls = { chat: [], tags: 0 };
  const fetchImpl = async (url, opts = {}) => {
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (url.endsWith('/api/tags')) {
      calls.tags += 1;
      return json(200, { models: tags.map((name) => ({ name })) });
    }
    if (url.endsWith('/api/chat')) {
      calls.chat.push({ url, body: JSON.parse(opts.body) });
      return chat ? chat(calls.chat.at(-1).body) : json(200, { done_reason: 'stop', message: { content: JSON.stringify({ items: [{ name: 'milk', days: 7 }] }) } });
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { calls, fetchImpl };
}

test('createLocal: off switches, Vercel rule, instruct defaults', () => {
  assert.equal(createLocal({ env: { LOCAL_LLM: 'off' } }), null);
  assert.equal(createLocal({ env: { LOCAL_LLM_URL: 'off' } }), null);
  assert.equal(createLocal({ env: { VERCEL: '1' } }), null); // no Ollama next to a Vercel function
  assert.ok(createLocal({ env: { VERCEL: '1', LOCAL_LLM_URL: 'https://ollama.example.com' } }));

  const local = createLocal({ env: {} });
  // The "-instruct" builds matter: plain qwen3-vl:2b / qwen3:4b are thinking models that burn their token budget.
  assert.deepEqual(local.models, { receipt: 'qwen3-vl:2b-instruct', recipes: 'qwen3:4b-instruct' });
  assert.deepEqual(createLocal({ env: { LOCAL_RECEIPT_MODEL: 'a', LOCAL_MODEL: 'b' } }).models, { receipt: 'a', recipes: 'b' });
});

test('createLocal: status reports reachability and which models are downloaded (cached briefly)', async () => {
  const ollama = fakeOllama({ tags: ['qwen3-vl:2b-instruct', 'qwen3:latest'] });
  const local = createLocal({ env: {}, fetchImpl: ollama.fetchImpl });
  assert.deepEqual(await local.status(), { reachable: true, ready: { receipt: true, recipes: false } });
  await local.status();
  assert.equal(ollama.calls.tags, 1); // second call served from cache

  const latest = createLocal({ env: { LOCAL_MODEL: 'qwen3' }, fetchImpl: ollama.fetchImpl });
  assert.equal((await latest.status()).ready.recipes, true); // "qwen3" matches "qwen3:latest"

  const down = createLocal({ env: {}, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.deepEqual(await down.status(), { reachable: false, ready: { receipt: false, recipes: false } });
});

test('createLocal: sends schema-constrained, deterministic chat requests; photos go in images[]', async () => {
  const ollama = fakeOllama();
  const local = createLocal({ env: { LOCAL_LLM_URL: 'http://box:11434/' }, fetchImpl: ollama.fetchImpl });

  assert.deepEqual(await local.parseReceipt('MILK 3.99'), [{ name: 'milk', days: 7 }]);
  assert.deepEqual(await local.scanReceipt({ base64: 'QUJD', mediaType: 'image/jpeg' }), [{ name: 'milk', days: 7 }]);

  const [text, photo] = ollama.calls.chat;
  assert.equal(text.url, 'http://box:11434/api/chat'); // trailing slash trimmed
  assert.equal(text.body.model, 'qwen3-vl:2b-instruct');
  assert.equal(text.body.stream, false);
  assert.equal(text.body.think, false);
  assert.equal(text.body.keep_alive, '30m');
  assert.equal(text.body.format.type, 'object'); // JSON schema constrains the output
  assert.equal(text.body.options.temperature, 0);
  assert.ok(text.body.options.num_predict > 0);
  assert.equal(text.body.messages[0].role, 'system');
  assert.ok(text.body.messages[0].content.includes('"items"')); // literal output example for small models
  assert.ok(text.body.messages[1].content.includes('MILK 3.99'));
  assert.equal(text.body.messages[1].images, undefined);
  assert.deepEqual(photo.body.messages[1].images, ['QUJD']);
});

test('createLocal: recipes use the recipe model; failures throw clear errors', async () => {
  const recipes = { recipes: [{ title: 'Omelette', time_minutes: 10, uses: ['eggs'], extras: [], steps: ['Cook'] }] };
  const ollama = fakeOllama({ chat: () => ({ ok: true, status: 200, json: async () => ({ done_reason: 'stop', message: { content: JSON.stringify(recipes) } }) }) });
  const local = createLocal({ env: {}, fetchImpl: ollama.fetchImpl });
  assert.deepEqual(await local.suggestRecipes([{ name: 'eggs', daysLeft: 1 }]), recipes.recipes);
  assert.equal(ollama.calls.chat[0].body.model, 'qwen3:4b-instruct');
  assert.ok(ollama.calls.chat[0].body.messages[1].content.includes('eggs: expires in 1 day'));

  const reply = (status, body) => fakeOllama({ chat: () => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) });
  const httpErr = createLocal({ env: {}, fetchImpl: reply(500, { error: 'model failed to load' }).fetchImpl });
  await assert.rejects(httpErr.parseReceipt('x'), /Ollama returned 500.*model failed to load/);
  const cut = createLocal({ env: {}, fetchImpl: reply(200, { done_reason: 'length', message: { content: '{"items":[' } }).fetchImpl });
  await assert.rejects(cut.parseReceipt('x'), /cut off/);
  const empty = createLocal({ env: {}, fetchImpl: reply(200, { done_reason: 'stop', message: { content: '' } }).fetchImpl });
  await assert.rejects(empty.parseReceipt('x'), /no text/);
});
