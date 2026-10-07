import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../lib/api.js';
import { createAi } from '../lib/ai.js';
import { resolveConfig } from '../lib/runtime.js';
import { sanitizeParsedItems, sanitizeRecipes } from '../lib/sanitize.js';

const fakeAi = (overrides = {}) => ({
  model: 'fake-model',
  parseReceipt: async () => [
    { name: ' Milk ', days: 7.4 },
    { name: 'milk', days: 3 }, // duplicate after normalising
    { name: 'eggs', days: 99999 }, // clamped
    { name: 'broken', days: 'soon' }, // dropped
    { days: 5 }, // dropped
  ],
  suggestRecipes: async () => [{ title: ' Omelette ', time_minutes: 10, uses: ['eggs'], extras: ['salt'], steps: ['Whisk', 'Cook'] }, { title: '' }],
  ...overrides,
});

const post = (body, headers = {}) => ({ method: 'POST', headers, body });

test('health reports AI state and never leaks the access code', () => {
  const off = createApi({ ai: null, disabledReason: 'no_api_key' }).health({ method: 'GET', headers: {} });
  assert.deepEqual(off.body, { ok: true, ai: false, needsCode: false, codeOk: null, model: null, reason: 'no_api_key' });

  const api = createApi({ ai: fakeAi(), accessCode: 'sesame' });
  assert.equal(api.health({ method: 'GET', headers: {} }).body.codeOk, false);
  assert.equal(api.health({ method: 'GET', headers: { 'x-access-code': 'nope' } }).body.codeOk, false);
  const ok = api.health({ method: 'GET', headers: { 'x-access-code': 'sesame' } });
  assert.equal(ok.body.codeOk, true);
  assert.ok(!JSON.stringify(ok.body).includes('sesame'));
  assert.equal(api.health({ method: 'POST', headers: {} }).status, 405);
});

test('access code gate: missing, wrong, and right codes', async () => {
  const api = createApi({ ai: fakeAi(), accessCode: 'sesame' });
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
  const api = createApi({ ai: fakeAi() });
  const ok = await api.parseReceipt(post({ text: 'MILK 3.99\nEGGS 2.99' }));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.items, [
    { name: 'milk', days: 7 },
    { name: 'eggs', days: 3650 },
  ]);

  assert.equal((await api.parseReceipt(post({}))).status, 400);
  assert.equal((await api.parseReceipt(post({ text: '   ' }))).status, 400);
  assert.equal((await api.parseReceipt(post({ text: 'x'.repeat(20_001) }))).status, 413);
  assert.equal((await api.parseReceipt({ method: 'GET', headers: {}, body: undefined })).status, 405);
});

test('parseReceipt: 503 without AI, 502 when the model call fails', async () => {
  assert.equal((await createApi({ ai: null }).parseReceipt(post({ text: 'milk' }))).status, 503);
  const failing = createApi({ ai: fakeAi({ parseReceipt: async () => { throw new Error('boom'); } }) });
  const res = await failing.parseReceipt(post({ text: 'milk' }));
  assert.equal(res.status, 502);
  assert.ok(!JSON.stringify(res.body).includes('boom')); // internal error text is not leaked
});

test('recipes: validates items, sanitises output', async () => {
  const api = createApi({ ai: fakeAi() });
  const good = await api.recipes(post({ items: [{ name: 'eggs', daysLeft: 1 }] }));
  assert.equal(good.status, 200);
  assert.deepEqual(good.body.recipes, [{ title: 'Omelette', time_minutes: 10, uses: ['eggs'], extras: ['salt'], steps: ['Whisk', 'Cook'] }]);

  for (const items of [undefined, [], 'eggs', [{ name: 'eggs' }], [{ name: 'eggs', daysLeft: -1 }], [{ name: '', daysLeft: 1 }], [{ name: 'eggs', daysLeft: 1.5 }]]) {
    assert.equal((await api.recipes(post({ items }))).status, 400, JSON.stringify(items));
  }
  const tooMany = Array.from({ length: 41 }, (_, i) => ({ name: `item ${i}`, daysLeft: 1 }));
  assert.equal((await api.recipes(post({ items: tooMany }))).status, 400);

  const empty = createApi({ ai: fakeAi({ suggestRecipes: async () => [] }) });
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
  assert.equal(resolveConfig({}).ai, null);

  // Public deployment with a key but no access code: refuse to use the key.
  const exposed = resolveConfig({ ANTHROPIC_API_KEY: 'sk-ant-test', VERCEL: '1' });
  assert.equal(exposed.ai, null);
  assert.equal(exposed.disabledReason, 'access_code_required');

  const locked = resolveConfig({ ANTHROPIC_API_KEY: 'sk-ant-test', VERCEL: '1', APP_ACCESS_CODE: 'sesame' });
  assert.ok(locked.ai);
  assert.equal(locked.accessCode, 'sesame');

  // Local dev with a key works without a code.
  assert.ok(resolveConfig({ ANTHROPIC_API_KEY: 'sk-ant-test' }).ai);
});

// ---- AI request shape ------------------------------------------------------

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

test('createAi: returns null without credentials, builds correct requests with a client', async () => {
  assert.equal(createAi({ env: {} }), null);

  const client = fakeClient(JSON.stringify({ items: [{ name: 'milk', days: 7 }] }));
  const ai = createAi({ client, model: 'claude-opus-5-5' });
  assert.deepEqual(await ai.parseReceipt('MILK 3.99'), [{ name: 'milk', days: 7 }]);

  const req = client.calls[0];
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(req.output_config.effort, 'low');
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.thinking, undefined); // Opus 5.5 rejects disabled/budgeted thinking
  assert.equal(req.temperature, undefined); // sampling params are rejected on this model
  assert.ok(req.messages[0].content.includes('<receipt>') && req.messages[0].content.includes('MILK 3.99'));
});

test('createAi: refusals, truncation and empty responses throw', async () => {
  const refused = createAi({ client: fakeClient('', { stop_reason: 'refusal' }) });
  await assert.rejects(refused.parseReceipt('x'), /declined/);
  const cut = createAi({ client: fakeClient('{"items":[', { stop_reason: 'max_tokens' }) });
  await assert.rejects(cut.parseReceipt('x'), /cut off/);
  const none = createAi({ client: { beta: { messages: { create: async () => ({ stop_reason: 'end_turn', content: [] }) } } } });
  await assert.rejects(none.parseReceipt('x'), /no text/);
});

test('createAi: recipe prompt lists items with days left', async () => {
  const client = fakeClient(JSON.stringify({ recipes: [] }));
  await createAi({ client }).suggestRecipes([{ name: 'eggs', daysLeft: 1 }, { name: 'milk', daysLeft: 0 }]);
  const prompt = client.calls[0].messages[0].content;
  assert.ok(prompt.includes('eggs: expires in 1 day\n'));
  assert.ok(prompt.includes('milk: expires in 0 days'));
  assert.equal(client.calls[0].output_config.effort, 'medium');
});
