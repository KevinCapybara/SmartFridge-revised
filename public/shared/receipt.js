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

// Household goods that show up on grocery receipts. Used to drop non-food a small model let through.
const NON_FOOD_ITEM = /\b(paper|towels?|tissues?|napkins?|soap|detergent|shampoo|conditioner|toothpaste|toothbrush|batter(?:y|ies)|foil|trash|garbage|diapers?|cleaner|sponges?|candles?|razors?|bags?|lotion|deodorant|vitamins?|dish)\b/;

/**
 * Tidy items a small model extracted from a receipt: swap in the app's generic name and
 * shelf life for foods it knows ("chkn brst bns" -> chicken, 3 days), drop household goods,
 * and de-duplicate. Foods it doesn't know keep the model's name and days.
 * Input and output are [{ name, days }].
 */
export function normalizeWithFoodList(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const cleaned = cleanReceiptLine(String(item?.name ?? ''));
    if (cleaned.length < 2 || NON_FOOD_ITEM.test(cleaned)) continue;
    const food = findFood(cleaned);
    const name = food ? food.name : cleaned;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, days: food ? food.days : item.days });
  }
  return out;
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
