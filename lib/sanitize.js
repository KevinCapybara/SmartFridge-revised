// Model output is untrusted: coerce it into the exact shapes the app expects.

import { MAX_DAYS, MAX_ITEMS_PER_BATCH } from '../public/shared/items.js';

export function sanitizeParsedItems(list) {
  const seen = new Set();
  const items = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw?.name !== 'string') continue;
    const name = raw.name.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
    const days = Math.round(Number(raw.days));
    if (!name || seen.has(name) || !Number.isFinite(days)) continue;
    seen.add(name);
    items.push({ name, days: Math.min(Math.max(days, 0), MAX_DAYS) });
    if (items.length >= MAX_ITEMS_PER_BATCH) break;
  }
  return items;
}

export function sanitizeRecipes(list) {
  const strings = (v, max) =>
    Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().slice(0, 500)).slice(0, max) : [];
  const recipes = [];
  for (const r of Array.isArray(list) ? list : []) {
    if (typeof r?.title !== 'string' || !r.title.trim()) continue;
    const minutes = Math.round(Number(r.time_minutes));
    recipes.push({
      title: r.title.trim().slice(0, 120),
      time_minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
      uses: strings(r.uses, 30),
      extras: strings(r.extras, 30),
      steps: strings(r.steps, 20),
    });
    if (recipes.length >= 5) break;
  }
  return recipes;
}
