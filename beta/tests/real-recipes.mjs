// Butter Math golden set, part 3: 100 real recipes from 91 recipe sites (Nov 20, 2026).
// The recipes are the ones members actually save, read through Butter Math's own link import.
// real-recipes.txt holds every ingredient line exactly as the site gave it ("#" lines name the page).
// real-recipes.snapshot.txt holds a short fingerprint of how each recipe's lines read today (the item, the amount,
// the aisle and the list key of every line), one per recipe in the same order. To see the readings, run  node tests/real-recipes.mjs
//
// Any change to how a line reads fails this check, so nothing changes by accident.
// When a change is on purpose (a fix), run  node tests/real-recipes.mjs --update  to save the new readings.
// Before saving, look over every line the check listed as changed.
//
// KNOWN lists lines that read wrong today, with the right reading. They don't fail the check, but the count
// is printed every run. When a fix makes one read right, the run says so: update the snapshot and remove it.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { splitIngredient, ingParts, ingTextToGroups, guessSection } from '../parse.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const SNAP = here + 'real-recipes.snapshot.txt';
// FNV-1a: a short fingerprint of a reading
const fp = s => { let h = 0x811c9dc5; for(const c of new TextEncoder().encode(s)){ h ^= c; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };

// [the line as the site writes it, the right reading as "Item | amount | aisle"]
export const KNOWN = [
  // amounts that aren't read
  ['325 gr bread flour (12.7% protein content) (plus more for dusting)', 'Bread flour | 325 gr | Baking aisle'],
  ['4 Tb butter', 'Butter | 4 Tb | Dairy & eggs'],
  ['1.5 qt vegetable stock (-low sodium)', 'Vegetable stock | 1.5 qt | Pasta, grains & canned'],
  ['4-1/2 teaspoons chili powder', 'Chili powder | 4½ teaspoons | Spices'],
  ['one 16-ounce can tomato sauce', 'Tomato sauce | 1 (16 oz) can | Pasta, grains & canned'],
  ['two 10-ounce cans diced tomatoes with green chilies (such as Rotel)', 'Diced tomatoes with green chilies | 2 (10 oz) cans | Pasta, grains & canned'],
  ['Optional: ½ cup frozen sweet corn', 'Frozen sweet corn | ½ cup | Frozen'],
  ['2 (8 oz.) bottles clam juice', 'Clam juice | 2 (8 oz.) bottles | Pasta, grains & canned'],
  ['1 carton (32 ounces) reduced-sodium chicken broth', 'Reduced-sodium chicken broth | 1 carton (32 ounces) | Pasta, grains & canned'],
  // count words left in the item, so it doesn't join the same item from another recipe
  ['2 stalks celery, diced', 'Celery | 2 stalks | Produce'],
  ['2 ribs celery (diced)', 'Celery | 2 ribs | Produce'],
  ['4 strips bacon', 'Bacon | 4 strips | Meat & seafood'],
  ['12 pieces of bacon (cut in half)', 'Bacon | 12 pieces | Meat & seafood'],
  ['1 ear grilled corn, kernels removed from the cob', 'Grilled corn | 1 ear | Produce'],
  ['1 pack enoki mushrooms ((200 g / 7 ounces ), root removed, rinsed and drained (optional))', 'Enoki mushrooms | 1 pack | Produce'],
  ['2 pouches Red Lobster Cheddar Bay Biscuit Mix', 'Red Lobster Cheddar Bay Biscuit Mix | 2 pouches | Baking aisle'],
  ['1 leaf bay', 'Bay leaf | 1 | Spices'],
  ['4 x-large eggs (cooked sunny side up or per your preference)', 'Eggs | 4 x-large | Dairy & eggs'],
  // the line is split in the wrong place
  ['4 whole cloves', 'Whole cloves | 4 | Spices'],
  ['1 cup whole or 2% milk', 'Whole or 2% milk | 1 cup | Dairy & eggs'],
  ['1 cup each – diced onions, celery, carrots', 'Onions, celery, carrots | 1 cup each | Produce'],
  // wrong aisle
  ['1/4 teaspoon white pepper (or black pepper)', 'White pepper | ¼ teaspoon | Spices'],
  ['4 teaspoons onion granules', 'Onion granules | 4 teaspoons | Spices'],
  ['¼ cup light or dark corn syrup', 'Light or dark corn syrup | ¼ cup | Baking aisle'],
  ['1 Tablespoon apple cider vinegar', 'Apple cider vinegar | 1 Tablespoon | Oils, sauces & condiments'],
  ['½ teaspoon dried rosemary', 'Dried rosemary | ½ teaspoon | Spices'],
  ['8 oz. egg noodles', 'Egg noodles | 8 oz. | Pasta, grains & canned'],
  ['1 ½ cup almond milk', 'Almond milk | 1½ cup | Dairy & eggs'],
  ['¼ cup unseasoned rice vinegar', 'Unseasoned rice vinegar | ¼ cup | Oils, sauces & condiments'],
  ['Pan drippings from the skillet after roasting', 'Pan drippings from the skillet after roasting |  | Other'],
  ['1 cup half-and-half', 'Half-and-half | 1 cup | Dairy & eggs'],
  ['5 ounces pancetta, diced into small bits', 'Pancetta | 5 ounces | Meat & seafood'],
  ['2 hot dogs, sliced into coins and halved', 'Hot dogs | 2 | Meat & seafood'],
  ['1 1/4 lb. ground chuck', 'Ground chuck | 1¼ lb. | Meat & seafood'],
  ['1 pound medium asparagus', 'Medium asparagus | 1 pound | Produce'],
  ['1 jalapeño (seeds removed, finely diced)', 'Jalapeño | 1 | Produce'],
  ['1/2 fennel bulb, diced', 'Fennel bulb | ½ | Produce'],
  ['1 lb. bay scallops', 'Bay scallops | 1 lb. | Meat & seafood'],
  ['pepperoni', 'Pepperoni |  | Meat & seafood'],
  ['1 cup Pizza Sauce', 'Pizza Sauce | 1 cup | Pasta, grains & canned'],
  ['1 tablespoon chopped chives', 'Chopped chives | 1 tablespoon | Produce'],
];

const read = s => { const p = splitIngredient(s); return `${p.name} | ${p.qty} | ${guessSection(p.name, p.qty)}`; };
// The full reading also has the list key, which decides which items share a shopping-list line
const full = s => read(s) + ' | ' + splitIngredient(s).key;

// Every part of every ingredient line, the way the app reads a recipe (headings like "For the sauce:" aren't items)
export function parts(){
  const recs = []; for(const l of readFileSync(here + 'real-recipes.txt', 'utf8').split('\n')){ if(l.startsWith('#')) recs.push({url: l.slice(1), lines: []}); else if(l.trim()) recs[recs.length - 1].lines.push(l); }
  const out = []; for(const r of recs) for(const g of ingTextToGroups(r.lines.join('\n'))) for(const it of g.items) for(const part of ingParts(it)) out.push({url: r.url, rec: r, line: it, part});
  return {recs, out};
}

// One fingerprint per recipe, over the readings of all its lines
const prints = (recs, out) => recs.map(r => fp(out.filter(x => x.rec === r).map(x => full(x.part)).join('\n')));

export function run(check){
  const {recs, out} = parts(); const snap = readFileSync(SNAP, 'utf8').split('\n').filter(Boolean), now = prints(recs, out);
  if(snap.length !== recs.length) check('real recipes: snapshot has one fingerprint per recipe (run with --update)', String(snap.length), String(recs.length));
  recs.forEach((r, i) => { const lines = out.filter(x => x.rec === r).map(x => `\n      ${x.part.slice(0, 60)}  =>  ${full(x.part)}`).join('');
    check(`real recipe ${r.url} reads differently now. Today's readings:${lines}\n     `, now[i], snap[i] || '(none)'); });
  let open = 0; const fixed = [];
  for(const [line, want] of KNOWN){ const got = read(line); if(got === want) fixed.push(line); else open++; }
  return {recipes: recs.length, sites: new Set(recs.map(r => r.url.split('/')[0])).size, lines: out.length, open, fixed};
}

// node tests/real-recipes.mjs           : list every line and how it reads today
// node tests/real-recipes.mjs --update  : save today's readings as the new fingerprints
if(process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]){
  const {recs, out} = parts(); let old = []; try{ old = readFileSync(SNAP, 'utf8').split('\n').filter(Boolean); }catch(e){}
  const now = prints(recs, out); let changed = 0;
  recs.forEach((r, i) => { const tag = old[i] && old[i] !== now[i] ? (changed++, '  (CHANGED)') : ''; console.log(`\n#${r.url}${tag}`); out.filter(x => x.rec === r).forEach(x => console.log(`  ${x.part}  =>  ${full(x.part)}`)); });
  if(process.argv.includes('--update')){ writeFileSync(SNAP, now.join('\n') + '\n'); console.log(`\nSaved readings for ${now.length} recipes (${changed} changed).`); }
  else console.log(`\n${changed} recipes read differently. Add --update to save these readings.`);
}
