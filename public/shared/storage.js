// On-device persistence. The whole fridge is a few dozen small records, so it
// lives in localStorage as one JSON document - like TinyDB in the original app.
// Takes the storage object as a parameter so tests can pass a fake one.

import { isValidDate } from './dates.js';
import { buildItem, MAX_ITEMS_PER_BATCH, ValidationError } from './items.js';

const KEY = 'smartfridge.v1';

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createStorage(backend = globalThis.localStorage) {
  function read() {
    try {
      const data = JSON.parse(backend.getItem(KEY));
      return Array.isArray(data?.items) ? data.items : [];
    } catch {
      return []; // missing, corrupt, or storage blocked: start empty rather than crash
    }
  }

  function write(items) {
    backend.setItem(KEY, JSON.stringify({ version: 1, items }));
  }

  return {
    all: read,

    add(input, today) {
      const item = { id: newId(), ...buildItem(input, today) };
      write([...read(), item]);
      return item;
    },

    /** All-or-nothing: if any entry is invalid nothing is saved. */
    addMany(inputs, today) {
      if (!Array.isArray(inputs) || inputs.length === 0) throw new ValidationError('Nothing to add');
      if (inputs.length > MAX_ITEMS_PER_BATCH) throw new ValidationError(`At most ${MAX_ITEMS_PER_BATCH} items at a time`);
      const created = inputs.map((input) => ({ id: newId(), ...buildItem(input, today) }));
      write([...read(), ...created]);
      return created;
    },

    update(id, changes) {
      const items = read();
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1) return null;
      items[idx] = { ...items[idx], ...changes };
      write(items);
      return items[idx];
    },

    remove(id) {
      const items = read();
      const next = items.filter((i) => i.id !== id);
      if (next.length === items.length) return false;
      write(next);
      return true;
    },

    /** Backup file contents. */
    exportJson() {
      return JSON.stringify({ app: 'smartfridge', version: 1, exportedAt: new Date().toISOString(), items: read() }, null, 2);
    },

    /** Replace the fridge with a backup. Entries that don't validate are skipped; returns how many were kept. */
    importJson(text) {
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new ValidationError('That file is not valid JSON');
      }
      if (!Array.isArray(data?.items)) throw new ValidationError('That file is not a SmartFridge backup');

      const kept = [];
      for (const raw of data.items.slice(0, 2000)) {
        try {
          if (!isValidDate(raw?.expiresOn)) continue;
          // buildItem re-validates name/quantity/expiresOn; keep the original addedOn when it is valid.
          const addedOn = isValidDate(raw.addedOn) ? raw.addedOn : raw.expiresOn;
          const item = buildItem({ name: raw.name, quantity: raw.quantity, expiresOn: raw.expiresOn }, addedOn);
          kept.push({ id: typeof raw.id === 'string' && raw.id ? raw.id : newId(), ...item });
        } catch {
          /* skip bad rows */
        }
      }
      write(kept);
      return kept.length;
    },
  };
}
