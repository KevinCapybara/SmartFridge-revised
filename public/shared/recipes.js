import { matchesKey } from './foods.js';

// Offline recipe book, used when no AI key is configured or the AI call fails.
// A recipe applies when every non-optional group has at least one fridge item
// matching one of its keys. Optional groups just add ingredients if present.

const BOOK = [
  {
    title: 'Veggie omelette',
    time_minutes: 10,
    groups: [
      { any: ['egg'] },
      { any: ['cheese', 'parm', 'cheddar', 'mozz', 'feta'], optional: true },
      { any: ['spinach', 'kale', 'mushroom', 'onion', 'tomato', 'pepper', 'zucchini', 'ham'], optional: true },
    ],
    extras: ['butter or oil', 'salt', 'pepper'],
    steps: [
      'Chop any vegetables or ham small and soften them in a buttered pan for 2-3 minutes.',
      'Whisk 2-3 eggs with a pinch of salt and pour over the filling.',
      'When the edges set, add cheese, fold the omelette in half and cook 1 more minute.',
    ],
  },
  {
    title: 'Stir-fry',
    time_minutes: 20,
    groups: [
      { any: ['chick', 'chkn', 'beef', 'steak', 'pork', 'tofu', 'shrimp'], optional: true },
      { any: ['broccoli', 'carrot', 'pepper', 'onion', 'mushroom', 'cabbage', 'zucchini', 'kale', 'celery'], min: 2 },
      { any: ['rice', 'noodle'], optional: true },
    ],
    extras: ['soy sauce', 'oil', 'garlic'],
    steps: [
      'Cut everything into bite-size pieces; cook rice or noodles if using.',
      'Sear the protein in a hot oiled pan until browned, then set aside.',
      'Stir-fry the vegetables 4-5 minutes, add protein back with a splash of soy sauce and garlic, toss 1 minute.',
      'Serve over rice or noodles.',
    ],
  },
  {
    title: 'Fruit smoothie',
    time_minutes: 5,
    groups: [
      { any: ['banana', 'strawb', 'blueb', 'raspb', 'mango', 'peach', 'pineapple', 'apple', 'spinach'], min: 1 },
      { any: ['milk', 'yogurt', 'yog', 'juice'], optional: true },
    ],
    extras: ['ice', 'honey (optional)'],
    steps: [
      'Add the fruit, a cup of milk, yogurt or juice, and a handful of ice to a blender.',
      'Blend until smooth, adding liquid to thin it out.',
      'Taste and sweeten with honey if needed.',
    ],
  },
  {
    title: 'Grilled cheese sandwich',
    time_minutes: 10,
    groups: [
      { any: ['bread', 'sourdough', 'bagel'] },
      { any: ['cheese', 'cheddar', 'mozz', 'swiss', 'provolone'] },
      { any: ['tomato', 'ham', 'deli', 'turkey', 'bacon'], optional: true },
    ],
    extras: ['butter'],
    steps: [
      'Butter the outsides of two slices of bread.',
      'Layer cheese (and tomato or ham if you have it) between the slices.',
      'Cook in a pan over medium heat 3 minutes per side until golden and melted.',
    ],
  },
  {
    title: 'Big salad',
    time_minutes: 10,
    groups: [
      { any: ['lettuce', 'romaine', 'spinach', 'kale', 'salad'] },
      { any: ['tomato', 'cucumb', 'carrot', 'pepper', 'onion', 'avocado', 'chick', 'egg', 'cheese', 'apple', 'grape'], min: 1 },
    ],
    extras: ['olive oil', 'vinegar or lemon', 'salt'],
    steps: [
      'Wash and tear the greens; slice or chop everything else.',
      'Toss together in a big bowl.',
      'Dress with olive oil, vinegar or lemon juice, and salt.',
    ],
  },
  {
    title: 'Pasta with whatever is in the fridge',
    time_minutes: 20,
    groups: [
      { any: ['pasta', 'spaghetti', 'penne', 'macaroni', 'noodle'] },
      { any: ['tomato', 'mushroom', 'spinach', 'onion', 'garlic', 'broccoli', 'zucchini', 'chick', 'sausage', 'cheese', 'parm'], min: 2 },
    ],
    extras: ['olive oil', 'salt', 'pepper'],
    steps: [
      'Boil the pasta in salted water until al dente; save a cup of cooking water.',
      'Sauté garlic and onion in olive oil, then add the other vegetables or meat until cooked through.',
      'Toss the pasta in the pan with a splash of pasta water; finish with cheese if you have it.',
    ],
  },
  {
    title: 'French toast',
    time_minutes: 15,
    groups: [
      { any: ['bread', 'bagel', 'sourdough', 'loaf'] },
      { any: ['egg'] },
      { any: ['milk'], optional: true },
    ],
    extras: ['butter', 'cinnamon', 'maple syrup'],
    steps: [
      'Whisk eggs with a splash of milk and a pinch of cinnamon.',
      'Dip each bread slice on both sides, then fry in butter 2-3 minutes per side.',
      'Serve with syrup or fruit.',
    ],
  },
  {
    title: 'Quesadillas',
    time_minutes: 15,
    groups: [
      { any: ['tortilla', '=wrap'] },
      { any: ['cheese', 'cheddar', 'mozz', 'jack'] },
      { any: ['chick', 'pepper', 'onion', 'beans', 'tomato', 'spinach', 'mushroom', 'corn'], optional: true },
    ],
    extras: ['oil or butter', 'salsa'],
    steps: [
      'Fill half of a tortilla with cheese and any chopped fillings, fold over.',
      'Toast in a lightly oiled pan 2-3 minutes per side until crisp and melted.',
      'Cut into wedges and serve with salsa.',
    ],
  },
  {
    title: 'Egg fried rice',
    time_minutes: 15,
    groups: [
      { any: ['rice'] },
      { any: ['egg'] },
      { any: ['carrot', 'peas', 'onion', 'pepper', 'broccoli', 'corn', 'cabbage', 'chick', 'ham', 'bacon'], optional: true },
    ],
    extras: ['soy sauce', 'oil', 'garlic'],
    steps: [
      'Stir-fry chopped vegetables and any meat in oil for 3-4 minutes.',
      'Push to the side, scramble the eggs in the pan, then mix everything together.',
      'Add cooked rice and soy sauce and fry 3-4 minutes until hot and slightly crisp.',
    ],
  },
  {
    title: 'Hearty vegetable soup',
    time_minutes: 35,
    groups: [
      { any: ['carrot', 'celery', 'onion', 'potato', 'tomato', 'zucchini', 'cabbage', 'broccoli', 'mushroom', 'kale'], min: 3 },
    ],
    extras: ['broth or water', 'olive oil', 'salt', 'pepper'],
    steps: [
      'Dice the vegetables and soften the onion and celery in oil for 5 minutes.',
      'Add the rest, cover with broth or water, and simmer 20-25 minutes until tender.',
      'Season to taste.',
    ],
  },
  {
    title: 'Yogurt parfait',
    time_minutes: 5,
    groups: [
      { any: ['yogurt', 'yog'] },
      { any: ['banana', 'strawb', 'blueb', 'raspb', 'mango', 'peach', 'apple', 'grape', 'granola', 'cereal'], min: 1 },
    ],
    extras: ['honey (optional)'],
    steps: ['Layer yogurt with chopped fruit (and granola or cereal if you have it) in a glass.', 'Drizzle with honey.'],
  },
  {
    title: 'Sheet-pan roasted vegetables',
    time_minutes: 35,
    groups: [
      { any: ['broccoli', 'cauliflower', 'carrot', 'potato', 'zucchini', 'pepper', 'onion', 'mushroom'], min: 2 },
    ],
    extras: ['olive oil', 'salt', 'pepper', 'garlic'],
    steps: [
      'Heat the oven to 425°F / 220°C.',
      'Cut vegetables to similar sizes, toss with oil, salt and pepper, and spread on a sheet pan.',
      'Roast 25-30 minutes, turning once, until browned at the edges.',
    ],
  },
  {
    title: 'Banana pancakes',
    time_minutes: 15,
    groups: [{ any: ['banana'] }, { any: ['egg'] }],
    extras: ['butter or oil', 'cinnamon (optional)'],
    steps: [
      'Mash 1 ripe banana and whisk in 2 eggs until combined.',
      'Spoon small rounds into a lightly buttered pan over medium heat.',
      'Cook 2 minutes per side until set and golden.',
    ],
  },
  {
    title: 'Loaded sandwich',
    time_minutes: 10,
    groups: [
      { any: ['bread', 'bagel', '=roll', '=rolls', '=bun', '=buns', 'tortilla'] },
      { any: ['ham', 'deli', 'turkey', 'chick', 'bacon', 'egg', 'cheese', 'tofu'] },
      { any: ['lettuce', 'tomato', 'cucumb', 'avocado', 'spinach'], optional: true },
    ],
    extras: ['mayo or mustard'],
    steps: ['Spread the bread, stack the protein and vegetables, and slice in half.'],
  },
];

function itemMatches(item, keys) {
  return keys.some((k) => matchesKey(item.name, k));
}

/**
 * Pick recipes that use the given fridge items, favouring the ones that use
 * the soonest-expiring food. `items` are [{ name, daysLeft }].
 */
export function suggestRecipesOffline(items, limit = 4) {
  const urgency = (item) => 1 + 10 / (1 + Math.max(item.daysLeft ?? 7, 0));
  const scored = [];

  for (const recipe of BOOK) {
    const used = new Map(); // item name -> item
    let ok = true;

    for (const group of recipe.groups) {
      const matches = items.filter((it) => itemMatches(it, group.any));
      if (!group.optional && matches.length < (group.min ?? 1)) {
        ok = false;
        break;
      }
      for (const m of matches) used.set(m.name, m);
    }
    if (!ok || used.size === 0) continue;

    const usedItems = [...used.values()];
    const score = usedItems.reduce((sum, it) => sum + urgency(it), 0);
    scored.push({
      score,
      recipe: {
        title: recipe.title,
        time_minutes: recipe.time_minutes,
        uses: usedItems.map((it) => it.name),
        extras: recipe.extras,
        steps: recipe.steps,
      },
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.recipe);
}
