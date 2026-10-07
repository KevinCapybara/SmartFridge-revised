import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, isValidDate, todayISO } from '../public/shared/dates.js';
import { estimateDays, findFood, matchesKey } from '../public/shared/foods.js';
import { normalizeWithFoodList, parseReceiptWithRules } from '../public/shared/receipt.js';
import { suggestRecipesOffline } from '../public/shared/recipes.js';
import {
  ValidationError,
  buildChanges,
  buildItem,
  cookableWithin,
  expiringWithin,
  presentItem,
} from '../public/shared/items.js';
import { createStorage } from '../public/shared/storage.js';

const TODAY = '2026-10-07';

// ---- dates -----------------------------------------------------------------

test('dates: validation, arithmetic and month/year boundaries', () => {
  assert.equal(isValidDate('2026-02-28'), true);
  assert.equal(isValidDate('2026-02-31'), false);
  assert.equal(isValidDate('2026-2-3'), false);
  assert.equal(isValidDate(20260207), false);
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29'); // leap year
  assert.equal(daysBetween('2026-10-07', '2026-10-10'), 3);
  assert.equal(daysBetween('2026-10-07', '2026-10-05'), -2);
  assert.equal(todayISO(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

// ---- foods -----------------------------------------------------------------

test('foods: matching rules avoid obvious false positives', () => {
  assert.equal(findFood('japanese eggplant')?.name, 'eggplant'); // not "eggs"
  assert.equal(findFood('large eggs')?.name, 'eggs');
  assert.equal(findFood('peanut butter')?.name, 'peanut butter');
  assert.equal(findFood('unsalted butter')?.name, 'butter');
  assert.equal(findFood('ham slices')?.name, 'ham');
  assert.equal(findFood('hamburger buns')?.name, 'hamburger buns');
  assert.equal(findFood('price drop'), null); // "rice" must not match inside "price"
  assert.equal(findFood('chicken broth')?.name, 'broth');
  assert.equal(matchesKey('Pineapple', 'apple'), false);
  assert.equal(matchesKey('green apple', 'apple'), true);
});

test('foods: estimateDays falls back to a week for unknown foods', () => {
  assert.equal(estimateDays('milk'), 7);
  assert.equal(estimateDays('salmon fillet'), 2);
  assert.equal(estimateDays('mystery item'), 7);
});

// ---- receipt rules ---------------------------------------------------------

test('receipt rules: extracts generic food names and ignores the rest', () => {
  const receipt = `
    SAFEWAY #1234
    123 MAIN ST  555-0100
    PARM CHEESE 8OZ        4.99
    FOLGERS CLASSIC 11.5OZ 7.99
    ORG BANANAS 1.2LB @ 0.59/LB   0.71
    CHKN BRST BNLS 2.1LB  8.44
    PARM CHEESE SHRED      3.99
    PAPER TOWELS 6PK       9.99
    SUBTOTAL              36.12
    TAX                    2.10
    TOTAL                 38.22
    VISA ************1234 38.22
  `;
  const items = parseReceiptWithRules(receipt);
  assert.deepEqual(
    items.map((i) => i.name),
    ['parmesan cheese', 'coffee', 'bananas', 'chicken'], // parmesan only once, no paper towels
  );
  assert.equal(items.find((i) => i.name === 'chicken').days, 3);
});

test('receipt rules: empty or junk text yields no items', () => {
  assert.deepEqual(parseReceiptWithRules(''), []);
  assert.deepEqual(parseReceiptWithRules('TOTAL 5.00\nTHANK YOU'), []);
});

test('normalizeWithFoodList: generic names and shelf lives for known foods, drops household goods', () => {
  // What a 2B vision model actually returned for the test receipt: right items, raw names, "7 days" for all.
  const modelOutput = ['org bananas', 'parm cheese', 'chkn brst bns', 'milk', 'eggs', 'folgers classic', 'baby spinach', 'paper towels', 'greek yogurt', 'salmon fillet'].map((name) => ({ name, days: 7 }));
  assert.deepEqual(normalizeWithFoodList(modelOutput), [
    { name: 'bananas', days: 5 },
    { name: 'parmesan cheese', days: 60 },
    { name: 'chicken', days: 3 },
    { name: 'milk', days: 7 },
    { name: 'eggs', days: 28 },
    { name: 'coffee', days: 180 },
    { name: 'spinach', days: 5 },
    { name: 'yogurt', days: 14 },
    { name: 'salmon', days: 2 },
  ]);

  // Unknown foods keep the model's name and days; duplicates collapse; junk is ignored.
  assert.deepEqual(normalizeWithFoodList([{ name: 'Tahini 16OZ', days: 90 }, { name: 'tahini', days: 30 }, { name: '', days: 5 }, null, { name: 'Dish soap', days: 7 }]), [{ name: 'tahini', days: 90 }]);
  assert.deepEqual(normalizeWithFoodList([]), []);
});

// ---- items -----------------------------------------------------------------

test('items: buildItem resolves expiry from date, days, or the food list', () => {
  assert.equal(buildItem({ name: 'Milk', expiresOn: '2026-10-20' }, TODAY).expiresOn, '2026-10-20');
  assert.equal(buildItem({ name: 'Milk', days: '4' }, TODAY).expiresOn, '2026-10-11');
  assert.equal(buildItem({ name: 'Milk', days: 0 }, TODAY).expiresOn, TODAY);
  assert.equal(buildItem({ name: 'Salmon' }, TODAY).expiresOn, '2026-10-09'); // 2-day estimate
  const item = buildItem({ name: '  Greek   yogurt ' }, TODAY);
  assert.equal(item.name, 'Greek yogurt');
  assert.equal(item.quantity, 1);
  assert.equal(item.addedOn, TODAY);
});

test('items: validation rejects bad input', () => {
  const bad = [
    { name: '' },
    { name: '   ' },
    { name: 5 },
    { name: 'x'.repeat(81) },
    { name: 'milk', quantity: 0 },
    { name: 'milk', quantity: 1.5 },
    { name: 'milk', days: -1 },
    { name: 'milk', days: 'abc' },
    { name: 'milk', days: 99999 },
    { name: 'milk', expiresOn: '2026-02-31' },
  ];
  for (const input of bad) assert.throws(() => buildItem(input, TODAY), ValidationError, JSON.stringify(input));
});

test('items: buildChanges only returns edited fields and rejects empty edits', () => {
  assert.deepEqual(buildChanges({ name: 'Oat milk', expiresOn: '2026-11-01' }, TODAY), { name: 'Oat milk', expiresOn: '2026-11-01' });
  assert.deepEqual(buildChanges({ days: 2 }, TODAY), { expiresOn: '2026-10-09' });
  assert.throws(() => buildChanges({}, TODAY), ValidationError);
});

test('items: status buckets and filtering', () => {
  const mk = (name, expiresOn) => ({ id: name, name, quantity: 1, addedOn: TODAY, expiresOn });
  const items = [mk('old', '2026-10-05'), mk('today', TODAY), mk('three', '2026-10-10'), mk('week', '2026-10-14'), mk('later', '2026-11-30')];

  assert.deepEqual(items.map((i) => presentItem(i, TODAY).status), ['expired', 'soon', 'soon', 'week', 'fresh']);
  assert.deepEqual(expiringWithin(items, 3, TODAY).map((i) => i.name), ['old', 'today', 'three']);
  // Recipes skip expired food and report days left.
  assert.deepEqual(cookableWithin(items, 7, TODAY), [
    { name: 'today', daysLeft: 0 },
    { name: 'three', daysLeft: 3 },
    { name: 'week', daysLeft: 7 },
  ]);
});

// ---- recipes ---------------------------------------------------------------

test('offline recipes: match what is in the fridge and favour expiring food', () => {
  const recipes = suggestRecipesOffline([
    { name: 'eggs', daysLeft: 1 },
    { name: 'spinach', daysLeft: 1 },
    { name: 'cheddar cheese', daysLeft: 10 },
  ]);
  assert.ok(recipes.length > 0);
  assert.equal(recipes[0].title, 'Veggie omelette');
  assert.ok(recipes[0].uses.includes('eggs') && recipes[0].uses.includes('spinach'));
  for (const r of recipes) assert.ok(r.steps.length > 0 && r.uses.length > 0);
});

test('offline recipes: no matching recipe returns an empty list', () => {
  assert.deepEqual(suggestRecipesOffline([{ name: 'ice cream', daysLeft: 2 }]), []);
  assert.deepEqual(suggestRecipesOffline([]), []);
});

// ---- storage ---------------------------------------------------------------

function fakeBackend(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), data };
}

test('storage: add, update, remove and persist across instances', () => {
  const backend = fakeBackend();
  const a = createStorage(backend);
  const milk = a.add({ name: 'milk', days: 5 }, TODAY);
  a.add({ name: 'eggs' }, TODAY);
  assert.equal(a.all().length, 2);

  assert.equal(a.update(milk.id, { expiresOn: '2026-10-30' }).expiresOn, '2026-10-30');
  assert.equal(a.update('missing', { name: 'x' }), null);

  const b = createStorage(backend); // a fresh instance sees the same data
  assert.equal(b.all().find((i) => i.id === milk.id).expiresOn, '2026-10-30');

  assert.equal(b.remove(milk.id), true);
  assert.equal(b.remove(milk.id), false);
  assert.equal(b.all().length, 1);
});

test('storage: addMany is all-or-nothing', () => {
  const s = createStorage(fakeBackend());
  assert.throws(() => s.addMany([{ name: 'milk' }, { name: '' }], TODAY), ValidationError);
  assert.equal(s.all().length, 0);
  assert.equal(s.addMany([{ name: 'milk', days: 3 }, { name: 'eggs', days: 20 }], TODAY).length, 2);
  assert.throws(() => s.addMany([], TODAY), ValidationError);
});

test('storage: corrupt data starts empty instead of crashing', () => {
  assert.deepEqual(createStorage(fakeBackend({ 'smartfridge.v1': '{not json' })).all(), []);
  assert.deepEqual(createStorage(fakeBackend({ 'smartfridge.v1': '{"items":"nope"}' })).all(), []);
});

test('storage: export then import round-trips and skips bad rows', () => {
  const src = createStorage(fakeBackend());
  src.add({ name: 'milk', days: 5, quantity: 2 }, TODAY);
  src.add({ name: 'eggs', days: 20 }, TODAY);
  const backup = src.exportJson();

  const dst = createStorage(fakeBackend());
  assert.equal(dst.importJson(backup), 2);
  assert.deepEqual(dst.all().map((i) => [i.name, i.quantity, i.expiresOn]).sort(), src.all().map((i) => [i.name, i.quantity, i.expiresOn]).sort());

  const messy = JSON.stringify({ items: [{ name: 'ok', expiresOn: '2026-11-01' }, { name: '', expiresOn: '2026-11-01' }, { name: 'bad date', expiresOn: 'nope' }, null] });
  assert.equal(dst.importJson(messy), 1);
  assert.equal(dst.all()[0].name, 'ok');

  assert.throws(() => dst.importJson('garbage'), ValidationError);
  assert.throws(() => dst.importJson('{"hello":1}'), ValidationError);
});
