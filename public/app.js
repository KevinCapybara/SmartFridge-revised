// SmartFridge (revised) front end. Plain ES modules, no build step.
// The fridge lives on this device (localStorage). The server is only used for
// the optional AI features, and every AI feature has an offline fallback.

import { createStorage } from './shared/storage.js';
import { buildChanges, cookableWithin, expiringWithin, presentItem, byExpiry, ValidationError } from './shared/items.js';
import { parseReceiptWithRules } from './shared/receipt.js';
import { suggestRecipesOffline } from './shared/recipes.js';

const $ = (id) => document.getElementById(id);

/** Tiny element builder. Text is always set via textContent, never innerHTML. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

let toastTimer;
function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isError ? 6000 : 3000);
}

function reportError(err) {
  if (err instanceof ValidationError) toast(err.message, true);
  else if (err?.name === 'QuotaExceededError') toast('This device is out of storage space for the app.', true);
  else {
    console.error(err);
    toast(err?.message || 'Something went wrong', true);
  }
}

// ---- device storage ---------------------------------------------------------

function safeLocalStorage() {
  try {
    const probe = '__smartfridge_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

const local = safeLocalStorage();
const memory = new Map();
const store = createStorage(local ?? { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) });

function getPref(key) {
  try {
    return local?.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function setPref(key, value) {
  try {
    if (value) local?.setItem(key, value);
    else local?.removeItem(key);
  } catch {
    /* preferences are a convenience only */
  }
}

// ---- optional AI ------------------------------------------------------------

const ai = { available: false, needsCode: false, codeOk: null, providers: {}, defaultProvider: null };
const aiUsable = () => ai.available && (!ai.needsCode || ai.codeOk);

const PROVIDER_NAMES = ['anthropic', 'openai', 'local'];
const PROVIDER_LABELS = { anthropic: 'Claude', openai: 'OpenAI GPT', local: 'Local open-source' };
const HOW_TO_ENABLE = {
  anthropic: 'set ANTHROPIC_API_KEY on the server',
  openai: 'set OPENAI_API_KEY on the server',
  local: 'run Ollama on the computer that runs this app',
};

/** Can this provider serve this feature right now? (A local model must be downloaded.) */
const providerReady = (name, feature) => Boolean(ai.providers[name]) && ai.providers[name].ready?.[feature] !== false;

/** Which provider to use for a feature ('receipt' | 'recipes'): the saved choice if usable, else the first usable one. */
function chosenProvider(feature) {
  const saved = getPref(`smartfridge.provider.${feature}`);
  if (providerReady(saved, feature)) return saved;
  return PROVIDER_NAMES.find((name) => providerReady(name, feature)) ?? null;
}

class AiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function codeHeaders() {
  const code = getPref('smartfridge.code');
  return code ? { 'x-access-code': code } : {};
}

async function aiFetch(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...codeHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AiError(res.status, data.code, data.error || `Request failed (${res.status})`);
  return data;
}

async function refreshHealth() {
  try {
    const health = await aiFetch('/api/health');
    ai.available = health.ai;
    ai.needsCode = health.needsCode;
    ai.codeOk = health.codeOk;
    ai.providers = health.providers ?? {};
    ai.defaultProvider = health.defaultProvider ?? null;
  } catch {
    ai.available = false; // offline or no server: built-in rules take over
    ai.providers = {};
    ai.defaultProvider = null;
  }
  renderAiBadge();
  renderModelPickers();
}

const MODEL_PICKERS = [
  { feature: 'receipt', selectId: 'receipt-provider', modelKey: 'receipt' },
  { feature: 'recipes', selectId: 'recipe-provider', modelKey: 'recipes' },
];

function renderModelPickers() {
  for (const { feature, selectId, modelKey } of MODEL_PICKERS) {
    const select = $(selectId);
    select.replaceChildren(
      ...PROVIDER_NAMES.map((name) => {
        const info = ai.providers[name];
        const base = PROVIDER_LABELS[name];
        const label = !info
          ? `${base} · ${name === 'local' ? 'Ollama not running' : 'not set up on the server'}`
          : providerReady(name, feature)
            ? `${base} · ${info.models[modelKey]}`
            : `${base} · ${info.models[modelKey]} (not downloaded)`;
        return h('option', { value: name, disabled: !providerReady(name, feature) }, label);
      }),
    );
    select.value = chosenProvider(feature) ?? '';
    select.disabled = !aiUsable() || PROVIDER_NAMES.filter((n) => providerReady(n, feature)).length < 2;
  }
  const missing = PROVIDER_NAMES.filter((n) => !ai.providers[n]);
  const notDownloaded = Object.entries(ai.providers).flatMap(([name, info]) =>
    MODEL_PICKERS.filter(({ modelKey }) => info.ready?.[modelKey] === false).map(({ modelKey }) => `ollama pull ${info.models[modelKey]}`),
  );
  $('model-hint').textContent = !ai.available
    ? ''
    : [
        notDownloaded.length ? `Download the missing local model${notDownloaded.length > 1 ? 's' : ''}: ${notDownloaded.join(' and ')}.` : '',
        missing.length ? `Not available: ${missing.map((n) => `${PROVIDER_LABELS[n]} (${HOW_TO_ENABLE[n]})`).join('; ')}.` : '',
        !notDownloaded.length && !missing.length ? 'Your choice is saved on this device.' : '',
      ]
        .filter(Boolean)
        .join(' ');
  renderVisionNote();
}

for (const { feature, selectId } of MODEL_PICKERS) {
  $(selectId).addEventListener('change', (e) => {
    setPref(`smartfridge.provider.${feature}`, e.target.value);
    renderVisionNote();
  });
}

$('vision-toggle').addEventListener('change', (e) => {
  setPref('smartfridge.visionOff', e.target.checked ? '' : '1');
  renderVisionNote();
});

function aiStatusText() {
  if (!ai.available) return 'AI is off. Receipts and recipes use the built-in food list and recipe book.';
  if (ai.needsCode && !ai.codeOk) return getPref('smartfridge.code') ? 'That access code is not correct.' : 'AI is available - enter the access code to unlock it.';
  return 'AI is on.';
}

function renderAiBadge() {
  const badge = $('ai-badge');
  badge.hidden = false;
  badge.textContent = aiUsable() ? 'AI on' : ai.available ? 'AI locked - enter code in Settings' : 'AI off - using built-in food list & recipes';
  $('ai-status').textContent = aiStatusText();
}

/** Run an AI call; on any failure return null so the caller can fall back to offline rules. */
async function tryAi(path, body, feature) {
  if (!aiUsable()) return { result: null, warning: null };
  try {
    return { result: await aiFetch(path, { ...body, provider: chosenProvider(feature) ?? undefined }), warning: null };
  } catch (err) {
    if (err.code === 'access_code_invalid' || err.code === 'access_code_required') refreshHealth();
    console.warn('AI call failed:', err.message);
    return { result: null, warning: 'AI was unavailable, so the built-in lists were used instead.' };
  }
}

// ---- tabs -------------------------------------------------------------------

const TABS = ['fridge', 'scan', 'recipes'];
function showTab(name) {
  for (const t of TABS) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === name));
    $(`panel-${t}`).hidden = t !== name;
  }
  if (name === 'fridge') renderItems();
  window.scrollTo({ top: 0 });
}
for (const t of TABS) $(`tab-${t}`).addEventListener('click', () => showTab(t));

// ---- fridge -----------------------------------------------------------------

const state = { soonOnly: false, days: 3 };

function visibleItems() {
  const today = localToday();
  const all = store.all();
  return state.soonOnly ? expiringWithin(all, state.days, today) : all.map((i) => presentItem(i, today)).sort(byExpiry);
}

function expiryLabel(item) {
  const d = item.daysLeft;
  if (d < 0) return `Expired ${plural(-d, 'day')} ago`;
  if (d === 0) return 'Expires today';
  if (d === 1) return 'Expires tomorrow';
  return `Expires in ${d} days`;
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderItems() {
  const items = visibleItems();
  $('item-list').replaceChildren(...items.map(itemRow));
  $('empty').hidden = items.length > 0;
  $('empty').textContent = state.soonOnly
    ? `Nothing expires within ${plural(state.days, 'day')}.`
    : 'Your fridge is empty. Scan a receipt or add an item below.';
}

function itemRow(item) {
  return h(
    'li',
    { class: 'item' },
    h('div', {}, h('span', { class: 'item-name' }, item.name), item.quantity > 1 && h('span', { class: 'item-qty' }, ` ×${item.quantity}`)),
    h('span', { class: `pill ${item.status}` }, expiryLabel(item)),
    h('div', { class: 'item-meta' }, `Best by ${formatDate(item.expiresOn)}`),
    h(
      'div',
      { class: 'item-actions' },
      h('button', { class: 'btn small', onclick: () => openEdit(item) }, 'Edit'),
      h('button', { class: 'btn small danger', onclick: () => removeItem(item), 'aria-label': `Remove ${item.name}` }, 'Used / remove'),
    ),
  );
}

function removeItem(item) {
  try {
    store.remove(item.id);
    toast(`Removed ${item.name}`);
    renderItems();
  } catch (err) {
    reportError(err);
  }
}

function setFilter(soon) {
  state.soonOnly = soon;
  $('filter-all').setAttribute('aria-pressed', String(!soon));
  $('filter-soon').setAttribute('aria-pressed', String(soon));
  $('slider-row').hidden = !soon;
  renderItems();
}
$('filter-all').addEventListener('click', () => setFilter(false));
$('filter-soon').addEventListener('click', () => setFilter(true));

$('days-slider').addEventListener('input', (e) => {
  state.days = Number(e.target.value);
  $('days-out').textContent = state.days;
  $('days-s').textContent = state.days === 1 ? '' : 's';
  renderItems();
});

$('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = { name: $('add-name').value, quantity: $('add-qty').value };
  if ($('add-date').value) input.expiresOn = $('add-date').value;
  else if ($('add-days').value !== '') input.days = $('add-days').value;
  try {
    const item = presentItem(store.add(input, localToday()), localToday());
    toast(`Added ${item.name} - ${expiryLabel(item).toLowerCase()}`);
    e.target.reset();
    $('add-qty').value = 1;
    renderItems();
  } catch (err) {
    reportError(err);
  }
});

// Edit dialog
let editing = null;
function openEdit(item) {
  editing = item;
  $('edit-name').value = item.name;
  $('edit-qty').value = item.quantity;
  $('edit-date').value = item.expiresOn;
  $('edit-dialog').showModal();
}
$('edit-cancel').addEventListener('click', () => $('edit-dialog').close());
$('edit-form').addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    const changes = buildChanges({ name: $('edit-name').value, quantity: $('edit-qty').value, expiresOn: $('edit-date').value }, localToday());
    store.update(editing.id, changes);
    $('edit-dialog').close();
    toast('Saved');
    renderItems();
  } catch (err) {
    reportError(err);
  }
});

// ---- scan receipt -----------------------------------------------------------

let tesseractPromise;
function loadTesseract() {
  tesseractPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => {
      tesseractPromise = undefined;
      reject(new Error('Could not load the text-recognition library (are you offline?). You can paste the receipt text instead.'));
    };
    document.head.append(s);
  });
  return tesseractPromise;
}

/** On-device OCR: photo -> text in the box, for the user to review and send to "Find the food". */
async function readWithOcr(file, progress, status) {
  progress.value = 0;
  status.textContent = 'Loading text recognition…';
  const Tesseract = await loadTesseract();
  const result = await Tesseract.recognize(file, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        progress.value = m.progress;
        status.textContent = `Reading receipt on this device… ${Math.round(m.progress * 100)}%`;
      }
    },
  });
  const text = result.data.text.trim();
  $('receipt-text').value = text;
  return text;
}

function loadImage(file) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => (URL.revokeObjectURL(url), resolve(img));
    img.onerror = () => (URL.revokeObjectURL(url), reject(new Error('Could not read that image')));
    img.src = url;
  });
}

const MAX_IMAGE_BASE64_CHARS = 3_900_000; // keep under the server's / Vercel's request limit

/**
 * Shrink a phone photo to a JPEG small enough to upload (a raw photo is 3-10 MB).
 * Tries progressively smaller sizes until the base64 fits. Returns base64 without a data: prefix.
 */
async function photoToBase64Jpeg(file, { small = false } = {}) {
  const img = await loadImage(file); // the browser applies the photo's EXIF rotation
  // A local CPU model's time grows with image size, so give it a smaller picture.
  const sizes = small ? [[1280, 0.8], [1024, 0.75], [800, 0.7]] : [[2000, 0.8], [1600, 0.75], [1200, 0.7], [900, 0.6]];
  for (const [maxSide, quality] of sizes) {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not process that image');
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    if (base64.length <= MAX_IMAGE_BASE64_CHARS) return base64;
  }
  throw new Error('That photo is too large to upload');
}

const visionOn = () => aiUsable() && getPref('smartfridge.visionOff') !== '1';

function renderVisionNote() {
  const provider = chosenProvider('receipt');
  $('vision-note').textContent = !visionOn()
    ? 'The photo is read on this device and never uploaded.'
    : provider === 'local'
      ? 'The photo is read by an open-source model running on your own computer, so it never goes to a cloud service. Expect it to take a minute or two.'
      : `The photo is sent to ${PROVIDER_LABELS[provider] ?? 'the AI provider'} to be read; this app does not keep it. Turn this off in Settings to read photos on this device instead.`;
}

let scanning = false;

$('receipt-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (scanning) return toast('Still reading the last photo - one moment', true);
  scanning = true;

  const preview = $('receipt-preview');
  if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
  preview.dataset.url = URL.createObjectURL(file);
  preview.src = preview.dataset.url;
  preview.hidden = false;

  const progress = $('ocr-progress');
  const status = $('ocr-status');
  progress.hidden = false;
  $('parse-btn').disabled = true;

  try {
    // 1. Hybrid path: let the AI model read the photo directly (most accurate).
    if (visionOn()) {
      progress.removeAttribute('value'); // indeterminate
      const isLocal = chosenProvider('receipt') === 'local';
      status.textContent = isLocal ? 'Reading receipt with the local model - this can take a minute or two…' : 'Reading receipt with AI…';
      let warning = null;
      try {
        const base64 = await photoToBase64Jpeg(file, { small: isLocal });
        const { result, warning: w } = await tryAi('/api/receipt/scan', { image: base64, mediaType: 'image/jpeg' }, 'receipt');
        if (result) {
          status.textContent = 'Done. Check the list below.';
          showReview({ items: result.items, source: 'ai', model: result.model, fromPhoto: true });
          return;
        }
        warning = w;
      } catch (err) {
        console.warn('AI photo read failed:', err.message);
      }
      status.textContent = `${warning ?? 'AI could not read the photo.'} Reading it on this device instead…`;
    }

    // 2. Fallback / no-AI path: on-device OCR, then the user reviews the text.
    progress.value = 0;
    const text = await readWithOcr(file, progress, status);
    status.textContent = text
      ? 'Done. Fix any misread text below, then tap "Find the food".'
      : 'No text found in that image. Try a clearer photo, or paste the text.';
  } catch (err) {
    status.textContent = err.message;
  } finally {
    scanning = false;
    progress.hidden = true;
    $('parse-btn').disabled = false;
  }
});

$('parse-btn').addEventListener('click', async () => {
  const text = $('receipt-text').value;
  if (!text.trim()) return toast('Add a receipt photo or paste some text first', true);

  const btn = $('parse-btn');
  btn.disabled = true;
  btn.textContent = 'Finding food…';
  try {
    const { result, warning } = await tryAi('/api/receipt/parse', { text }, 'receipt');
    showReview(
      result
        ? { items: result.items, source: 'ai', model: result.model }
        : { items: parseReceiptWithRules(text), source: 'rules', warning },
    );
  } catch (err) {
    reportError(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find the food';
  }
});

function reviewRow(item = { name: '', days: 7 }) {
  const row = h(
    'li',
    { class: 'review-row' },
    h('input', { 'aria-label': 'Food name', value: item.name, maxlength: 80, placeholder: 'Food name' }),
    h(
      'span',
      { class: 'days-wrap' },
      h('input', { 'aria-label': 'Days until it expires', type: 'number', min: 0, max: 3650, value: item.days, inputmode: 'numeric' }),
      h('span', {}, 'days'),
    ),
    h('button', { class: 'btn small danger', 'aria-label': 'Remove row', onclick: () => row.remove() }, '✕'),
  );
  return row;
}

function showReview({ items, source, warning, model, fromPhoto = false }) {
  $('review-card').hidden = false;
  $('review-list').replaceChildren(...items.map(reviewRow));
  const parts = [];
  if (items.length === 0) parts.push('No food found. Add rows yourself, or try a clearer photo or edit the receipt text.');
  else parts.push('Edit names and days, remove rows that are wrong, then add them to your fridge.');
  if (source === 'ai') parts.push(fromPhoto ? `Read from the photo by ${model}.` : `Parsed by ${model}.`);
  if (source === 'rules') parts.push('Matched using the built-in food list (no AI).');
  if (warning) parts.push(warning);
  $('review-note').textContent = parts.join(' ');
  $('review-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('review-add-row').addEventListener('click', () => $('review-list').append(reviewRow()));

$('review-save').addEventListener('click', () => {
  const entries = [...$('review-list').children]
    .map((row) => {
      const [name, days] = row.querySelectorAll('input');
      return { name: name.value.trim(), days: days.value };
    })
    .filter((i) => i.name);
  if (entries.length === 0) return toast('Nothing to add', true);

  try {
    const created = store.addMany(entries, localToday());
    toast(`Added ${plural(created.length, 'item')} to your fridge`);
    $('review-card').hidden = true;
    $('review-list').replaceChildren();
    $('receipt-text').value = '';
    $('receipt-preview').hidden = true;
    $('ocr-status').textContent = '';
    showTab('fridge');
  } catch (err) {
    reportError(err);
  }
});

// ---- recipes ----------------------------------------------------------------

$('recipe-slider').addEventListener('input', (e) => ($('recipe-days-out').textContent = e.target.value));

$('recipe-btn').addEventListener('click', async () => {
  const btn = $('recipe-btn');
  const status = $('recipe-status');
  const withinDays = Number($('recipe-slider').value);
  // Expired food is left out on purpose - don't cook it.
  const items = cookableWithin(store.all(), withinDays, localToday());

  $('recipe-list').replaceChildren();
  if (items.length === 0) {
    status.textContent = `Nothing in your fridge expires within ${plural(withinDays, 'day')} (expired food is skipped).`;
    return;
  }

  btn.disabled = true;
  status.textContent = chosenProvider('recipes') === 'local' ? 'Finding recipes with the local model - this can take a minute…' : 'Finding recipes…';
  try {
    const { result, warning } = await tryAi('/api/recipes', { items }, 'recipes');
    const recipes = result?.recipes ?? suggestRecipesOffline(items);
    const notes = [`Using: ${items.map((i) => i.name).join(', ')}.`];
    if (!recipes.length) notes.push("Couldn't match those items to a simple recipe. Try a longer time window.");
    if (result) notes.push(`Recipes by ${result.model}.`);
    else if (warning) notes.push(warning);
    else if (recipes.length) notes.push('Built-in recipes (no AI).');
    status.textContent = notes.join(' ');
    $('recipe-list').replaceChildren(...recipes.map(recipeCard));
  } catch (err) {
    status.textContent = '';
    reportError(err);
  } finally {
    btn.disabled = false;
  }
});

function recipeCard(r) {
  return h(
    'article',
    { class: 'card recipe' },
    h('h3', {}, r.title),
    r.time_minutes ? h('div', { class: 'time' }, `About ${r.time_minutes} min`) : null,
    h('ul', { class: 'chips', 'aria-label': 'Ingredients' }, r.uses.map((u) => h('li', { class: 'chip' }, u)), r.extras.map((x) => h('li', { class: 'chip extra' }, x))),
    h('ol', {}, r.steps.map((s) => h('li', {}, s))),
  );
}

// ---- settings & backup ------------------------------------------------------

$('settings-btn').addEventListener('click', () => {
  $('code-input').value = getPref('smartfridge.code');
  $('vision-toggle').checked = getPref('smartfridge.visionOff') !== '1';
  renderAiBadge();
  $('settings-dialog').showModal();
});
$('settings-close').addEventListener('click', () => $('settings-dialog').close());

$('code-save').addEventListener('click', async () => {
  setPref('smartfridge.code', $('code-input').value.trim());
  await refreshHealth();
  toast(aiUsable() ? 'AI unlocked' : aiStatusText(), !aiUsable() && ai.available);
});

$('export-btn').addEventListener('click', async () => {
  const name = `smartfridge-backup-${localToday()}.json`;
  const file = new File([store.exportJson()], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'SmartFridge backup' }); // iOS share sheet: Save to Files
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return; // user closed the share sheet
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
});

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!confirm('Replace everything in your fridge with the contents of this backup?')) return;
  try {
    const kept = store.importJson(await file.text());
    toast(`Restored ${plural(kept, 'item')}`);
    $('settings-dialog').close();
    renderItems();
  } catch (err) {
    reportError(err);
  }
});

// ---- install hint -----------------------------------------------------------

function setupInstallHint() {
  if (getPref('smartfridge.installDismissed')) return;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return;

  const banner = $('install-banner');
  $('install-dismiss').addEventListener('click', () => {
    banner.hidden = true;
    setPref('smartfridge.installDismissed', '1');
  });

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIos) {
    $('install-text').textContent = 'Install SmartFridge: tap the Share button in Safari, then "Add to Home Screen".';
    banner.hidden = false;
    return;
  }

  // Android / desktop Chrome: offer the native install prompt.
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    $('install-text').textContent = 'Install SmartFridge on this device for quick access and offline use.';
    $('install-btn').hidden = false;
    $('install-btn').onclick = async () => {
      banner.hidden = true;
      await event.prompt();
    };
    banner.hidden = false;
  });
}

// ---- start ------------------------------------------------------------------

if (!local) toast('Browser storage is blocked, so your fridge will be lost when you close the app.', true);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Service worker not registered:', err.message));
}

setupInstallHint();
renderItems();
renderVisionNote();
refreshHealth();
