import { findFood } from './foods.js';

const NON_FOOD_LINE = /\b(sub\s?total|total|tax|change|cash|visa|mastercard|amex|debit|credit|balance|savings|coupon|discount|thank|receipt|approved|auth|items? sold|survey|store|phone|tel)\b/i;

/** Strip prices, quantities, weights and codes so only the product words remain. */
export function cleanReceiptLine(line) {
  return line
    .toLowerCase()
    .replace(/[$€£]?\s?\d+[.,]\d{2}\b-?/g, ' ') // prices
    .replace(/\b\d+(\.\d+)?\s?(oz|lb|lbs|kg|g|ct|pk|pkg|gal|l|ml|fl)\b/g, ' ') // weights / sizes
    .replace(/\b\d+\s?@\s?\S+/g, ' ') // "2 @ 1.99"
    .replace(/\b\d{4,}\b/g, ' ') // item codes / UPCs
    .replace(/[^a-z&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Offline receipt parser: keeps only lines that look like known foods and maps
 * them to a generic name + typical shelf life. Returns [{ name, days }].
 */
export function parseReceiptWithRules(text) {
  const seen = new Set();
  const items = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim() || NON_FOOD_LINE.test(raw)) continue;
    const cleaned = cleanReceiptLine(raw);
    if (cleaned.length < 3) continue;
    const food = findFood(cleaned);
    if (!food || seen.has(food.name)) continue;
    seen.add(food.name);
    items.push({ name: food.name, days: food.days });
  }
  return items;
}
