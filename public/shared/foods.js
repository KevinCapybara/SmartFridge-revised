// Offline knowledge base: typical shelf life (days) for common groceries.
// Used (a) to estimate an expiry when the user adds an item by name only and
// (b) as the receipt parser when no AI key is configured or the AI call fails.
//
// Keys are matched against lowercase text. A plain key matches the start of a
// word ("chick" matches "chicken"); a key starting with "=" must match a whole
// word. Order matters - the first matching entry wins, so specific entries
// ("peanut butter") come before general ones ("butter").

export const DEFAULT_SHELF_LIFE_DAYS = 7;

export const FOODS = [
  // Dairy & eggs
  { name: 'peanut butter', days: 180, keys: ['peanut butter', 'pnut butter'] },
  { name: 'ice cream', days: 90, keys: ['ice cream', 'gelato'] },
  { name: 'cream cheese', days: 21, keys: ['cream cheese'] },
  { name: 'cottage cheese', days: 10, keys: ['cottage'] },
  { name: 'sour cream', days: 21, keys: ['sour cream'] },
  { name: 'parmesan cheese', days: 60, keys: ['parm'] },
  { name: 'cheddar cheese', days: 35, keys: ['cheddar', 'chdr'] },
  { name: 'mozzarella cheese', days: 21, keys: ['mozz'] },
  { name: 'feta cheese', days: 21, keys: ['feta'] },
  { name: 'cheese', days: 30, keys: ['cheese', 'swiss', 'provolone', 'gouda', '=jack'] },
  { name: 'heavy cream', days: 10, keys: ['heavy cream', 'whipping cream', 'half & half', 'half and half', '=cream'] },
  { name: 'milk', days: 7, keys: ['milk'] },
  { name: 'butter', days: 30, keys: ['butter', 'margarine'] },
  { name: 'yogurt', days: 14, keys: ['yogurt', 'yoghurt', 'yog'] },
  { name: 'eggplant', days: 7, keys: ['eggplant'] },
  { name: 'eggs', days: 28, keys: ['egg'] },

  // Meat & fish
  { name: 'broth', days: 730, keys: ['broth', 'bouillon', 'stock'] },
  { name: 'ground beef', days: 2, keys: ['ground beef', 'gr beef', 'grnd beef', 'ground turkey', 'ground pork'] },
  { name: 'hamburger buns', days: 7, keys: ['hamburger bun', 'hamburger roll', 'hot dog bun'] },
  { name: 'hot dogs', days: 14, keys: ['hot dog', 'hotdog', 'frank'] },
  { name: 'chicken', days: 3, keys: ['chick', 'chkn', 'chx'] },
  { name: 'steak', days: 4, keys: ['steak', 'ribeye', 'sirloin', 'beef', 'brisket', 'roast'] },
  { name: 'pork', days: 4, keys: ['pork', 'tenderloin'] },
  { name: 'bacon', days: 7, keys: ['bacon'] },
  { name: 'sausage', days: 5, keys: ['sausage', 'saus', 'bratwurst', 'brats'] },
  { name: 'ham', days: 7, keys: ['=ham'] },
  { name: 'deli meat', days: 5, keys: ['deli', 'lunch meat', 'turkey', 'salami', 'pastrami', 'prosciutto'] },
  { name: 'salmon', days: 2, keys: ['salmon'] },
  { name: 'shrimp', days: 2, keys: ['shrimp', 'prawn'] },
  { name: 'fish', days: 2, keys: ['fish', 'cod', 'tilapia', 'halibut', 'trout', 'tuna steak'] },

  // Produce
  { name: 'sweet potatoes', days: 21, keys: ['sweet potato', 'yam'] },
  { name: 'potatoes', days: 21, keys: ['potato', 'russet'] },
  { name: 'bell peppers', days: 7, keys: ['bell pep', 'sweet pepper', 'jalapeno', 'pepper'] },
  { name: 'apples', days: 28, keys: ['apple', 'gala', 'fuji'] },
  { name: 'bananas', days: 5, keys: ['banana'] },
  { name: 'oranges', days: 14, keys: ['orange', 'clementine', 'tangerine', 'mandarin'] },
  { name: 'lemons', days: 21, keys: ['lemon'] },
  { name: 'limes', days: 21, keys: ['lime'] },
  { name: 'grapes', days: 7, keys: ['grape'] },
  { name: 'strawberries', days: 5, keys: ['strawb', 'strwb'] },
  { name: 'blueberries', days: 7, keys: ['blueb'] },
  { name: 'raspberries', days: 3, keys: ['raspb', 'blackb'] },
  { name: 'avocados', days: 4, keys: ['avocado', 'avo'] },
  { name: 'tomatoes', days: 7, keys: ['tomato', 'tmto'] },
  { name: 'lettuce', days: 7, keys: ['lettuce', 'romaine', 'salad'] },
  { name: 'spinach', days: 5, keys: ['spinach'] },
  { name: 'kale', days: 7, keys: ['kale'] },
  { name: 'broccoli', days: 5, keys: ['broccoli', 'brocc'] },
  { name: 'cauliflower', days: 7, keys: ['cauliflower'] },
  { name: 'carrots', days: 21, keys: ['carrot'] },
  { name: 'celery', days: 14, keys: ['celery'] },
  { name: 'cucumbers', days: 7, keys: ['cucumb', 'cuke'] },
  { name: 'onions', days: 30, keys: ['onion', 'shallot'] },
  { name: 'garlic', days: 30, keys: ['garlic'] },
  { name: 'mushrooms', days: 7, keys: ['mushroom', 'shroom'] },
  { name: 'zucchini', days: 7, keys: ['zucchini', 'squash'] },
  { name: 'cabbage', days: 14, keys: ['cabbage'] },
  { name: 'corn', days: 5, keys: ['=corn'] },
  { name: 'peas', days: 5, keys: ['=peas'] },
  { name: 'green beans', days: 7, keys: ['green bean'] },
  { name: 'peaches', days: 5, keys: ['peach', 'nectarine', 'plum'] },
  { name: 'pears', days: 5, keys: ['=pear', '=pears'] },
  { name: 'melon', days: 7, keys: ['melon', 'cantaloupe'] },
  { name: 'pineapple', days: 5, keys: ['pineapple'] },
  { name: 'mangoes', days: 5, keys: ['mango'] },
  { name: 'fresh herbs', days: 7, keys: ['cilantro', 'parsley', 'basil', 'mint', 'dill'] },

  // Bakery
  { name: 'bagels', days: 7, keys: ['bagel'] },
  { name: 'tortillas', days: 14, keys: ['tortilla', '=wrap', '=wraps'] },
  { name: 'bread', days: 7, keys: ['bread', 'loaf', 'sourdough', 'baguette', '=roll', '=rolls', '=bun', '=buns'] },

  // Prepared / pantry
  { name: 'hummus', days: 7, keys: ['hummus'] },
  { name: 'salsa', days: 14, keys: ['salsa'] },
  { name: 'tofu', days: 7, keys: ['tofu', 'tempeh'] },
  { name: 'orange juice', days: 10, keys: ['juice', '=oj'] },
  { name: 'pizza', days: 180, keys: ['pizza'] },
  { name: 'black pepper', days: 730, keys: ['black pepper'] },
  { name: 'olive oil', days: 365, keys: ['olive oil', 'canola oil', 'vegetable oil'] },
  { name: 'ketchup', days: 180, keys: ['ketchup', 'mustard', 'mayo'] },
  { name: 'jam', days: 180, keys: ['jelly', '=jam', 'preserves'] },
  { name: 'pasta', days: 365, keys: ['pasta', 'spaghetti', 'penne', 'macaroni', 'noodle', 'linguine', 'fettuc'] },
  { name: 'rice', days: 365, keys: ['rice'] },
  { name: 'cereal', days: 180, keys: ['cereal', 'cheerios', 'granola', 'oatmeal', 'oats'] },
  { name: 'flour', days: 365, keys: ['flour'] },
  { name: 'sugar', days: 730, keys: ['sugar'] },
  { name: 'canned beans', days: 730, keys: ['beans', 'chickpea', 'lentil'] },
  { name: 'soup', days: 730, keys: ['soup'] },
  { name: 'crackers', days: 90, keys: ['cracker'] },
  { name: 'chips', days: 60, keys: ['chips', 'pretzel'] },
  { name: 'cookies', days: 30, keys: ['cookie', 'oreo'] },
  { name: 'coffee', days: 180, keys: ['coffee', 'folgers', 'espresso'] },
  { name: 'tea', days: 365, keys: ['=tea'] },
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const matcherCache = new Map();
function matcherFor(key) {
  let re = matcherCache.get(key);
  if (!re) {
    re = key.startsWith('=')
      ? new RegExp(`(^|[^a-z])${escapeRegex(key.slice(1))}([^a-z]|$)`)
      : new RegExp(`(^|[^a-z])${escapeRegex(key)}`);
    matcherCache.set(key, re);
  }
  return re;
}

/** True if `text` (any case) contains `key` under the matching rules above. */
export function matchesKey(text, key) {
  return matcherFor(key).test(String(text).toLowerCase());
}

/** First FOODS entry whose keys match `text`, or null. */
export function findFood(text) {
  for (const food of FOODS) {
    if (food.keys.some((k) => matchesKey(text, k))) return food;
  }
  return null;
}

/** Best-guess shelf life in days for an item name. */
export function estimateDays(name) {
  return findFood(name)?.days ?? DEFAULT_SHELF_LIFE_DAYS;
}
