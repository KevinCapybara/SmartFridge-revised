// Fridge-item rules shared by the browser app and the tests: validation,
// expiry resolution and how an item is presented. No DOM or Node APIs here.

import { addDays, daysBetween, isValidDate } from './dates.js';
import { estimateDays } from './foods.js';

export const MAX_DAYS = 3650;
export const MAX_ITEMS_PER_BATCH = 100;

export class ValidationError extends Error {}

const hasValue = (v) => v !== undefined && v !== null && v !== '';

export function cleanName(value) {
  if (typeof value !== 'string') throw new ValidationError('Name is required');
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name) throw new ValidationError('Name is required');
  if (name.length > 80) throw new ValidationError('Name must be 80 characters or fewer');
  return name;
}

export function cleanQuantity(value) {
  if (!hasValue(value)) return 1;
  const q = Number(value);
  if (!Number.isInteger(q) || q < 1 || q > 999) throw new ValidationError('Quantity must be a whole number from 1 to 999');
  return q;
}

export function cleanDays(value) {
  const d = Number(value);
  if (!hasValue(value) || !Number.isInteger(d) || d < 0 || d > MAX_DAYS) {
    throw new ValidationError(`Days must be a whole number from 0 to ${MAX_DAYS}`);
  }
  return d;
}

export function cleanDate(value) {
  if (!isValidDate(value)) throw new ValidationError('Date must be a valid date');
  return value;
}

/** Explicit date wins, then a number of days from today, then a shelf-life guess for the name. */
export function resolveExpiry({ expiresOn, days }, name, today) {
  if (hasValue(expiresOn)) return cleanDate(expiresOn);
  if (hasValue(days)) return addDays(today, cleanDays(days));
  return addDays(today, estimateDays(name));
}

/** Validate user input and return a new item (without an id). */
export function buildItem(input, today) {
  const name = cleanName(input?.name);
  return {
    name,
    quantity: cleanQuantity(input?.quantity),
    addedOn: today,
    expiresOn: resolveExpiry(input ?? {}, name, today),
  };
}

/** Validate edits to an existing item; returns only the fields that changed. */
export function buildChanges(input, today) {
  const changes = {};
  if ('name' in input) changes.name = cleanName(input.name);
  if ('quantity' in input) changes.quantity = cleanQuantity(input.quantity);
  if (hasValue(input.expiresOn)) changes.expiresOn = cleanDate(input.expiresOn);
  else if (hasValue(input.days)) changes.expiresOn = addDays(today, cleanDays(input.days));
  if (Object.keys(changes).length === 0) throw new ValidationError('Nothing to update');
  return changes;
}

/** Adds daysLeft and a status bucket used for colouring. */
export function presentItem(item, today) {
  const daysLeft = daysBetween(today, item.expiresOn);
  const status = daysLeft < 0 ? 'expired' : daysLeft <= 3 ? 'soon' : daysLeft <= 7 ? 'week' : 'fresh';
  return { ...item, daysLeft, status };
}

export function byExpiry(a, b) {
  return a.expiresOn.localeCompare(b.expiresOn) || a.name.localeCompare(b.name);
}

/** Items that expire in `days` days or less (already-expired ones included), soonest first. */
export function expiringWithin(items, days, today) {
  return items
    .map((i) => presentItem(i, today))
    .filter((i) => i.daysLeft <= days)
    .sort(byExpiry);
}

/** Items still safe to cook with, expiring within `days` days, as { name, daysLeft }. */
export function cookableWithin(items, days, today, limit = 40) {
  return items
    .map((i) => presentItem(i, today))
    .filter((i) => i.daysLeft >= 0 && i.daysLeft <= days)
    .sort(byExpiry)
    .slice(0, limit)
    .map(({ name, daysLeft }) => ({ name, daysLeft }));
}
