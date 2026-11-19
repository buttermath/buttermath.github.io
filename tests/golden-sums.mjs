// Butter Math golden set, part 2: adding amounts across recipes.
// Part A: real combinations, with the expected total written by hand.
// Part B: hundreds of random combinations checked by a separate calculator (below) that shares no code
// with the app. It converts every amount to teaspoons or grams and checks that the app's total matches:
// nothing lost, nothing added, and the same answer whatever order the recipes were added in.
import { addQty } from '../parse.js';

const sum = (key, ...q) => q.reduce((a, b) => addQty(a, b, {key}), '');

export const HAND = [
  // [what it is, ingredient key, amounts..., expected total]
  ['dash can sizes add up', 'tomato puree', '1 (14 oz) can', '1 (14 oz) can', '2 (14 oz) cans'],
  ['different can sizes stay apart', 'tomato', '1 (14 oz) can', '1 (28 oz) can', '1 (14 oz) can + 1 (28 oz) can'],
  ['different sizes stay apart', 'onion', '1 large', '1 small', '1 large + 1 small'],
  ['in-between size stays apart', 'sweet potato', '1 medium-small', '1 medium', '1 medium-small + 1 medium'],
  ['same in-between size adds up', 'sweet potato', '1 medium-small', '1 medium-small', '2 medium-small'],
  ['no size joins the one size', 'egg', '2 large', '3', '5 large'],
  ['whole head of garlic + head', 'garlic', '1 whole head', '1 head', '2 heads'],
  ['heads of garlic', 'garlic', '1 head', '2 heads', '3 heads'],
  ['"3 garlic cloves" + "2 cloves garlic"', 'garlic', '3 cloves', '2 cloves', '5 cloves'],
  ['cinnamon with "of" (reported line)', 'cinnamon', '1 teaspoon', '1 teaspoon', '2 tsp'],
  ['flour with "of" plus cups', 'flour', '1 cup', '1½ cups', '2½ cups'],
  ['two pies of butter', 'unsalted butter', '1 cup (2 sticks; 226g)', '1 cup (2 sticks; 226g)', '4 sticks (452g)'],
  ['cookies + cake butter', 'unsalted butter', '¾ cup (170g)', '½ cup (113g)', '2 sticks + 4 Tbsp (283g)'],
  ['butter Tbsp + sticks', 'unsalted butter', '6 Tbsp', '1 stick', '1 stick + 6 Tbsp'],
  ['peanut butter stays in cups', 'peanut butter', '½ cup', '¾ cup', '1¼ cups'],
  ['flour cups', 'flour', '2¼ cups (281g)', '3 cups (378g)', '5¼ cups (659g)'],
  ['flour with a plus amount', 'flour', '1 cup + 2 tablespoons', '1 cup', '2 cups + 2 Tbsp'],
  ['sugar thirds', 'sugar', '⅓ cup', '⅔ cup', '1 cup'],
  ['sugar quarters and thirds', 'sugar', '¼ cup', '⅓ cup', '½ cup + 1 Tbsp + 1 tsp'],
  ['vanilla teaspoons to a tablespoon', 'vanilla', '2 teaspoons', '1 tsp', '1 Tbsp'],
  ['salt small amounts', 'salt', '½ teaspoon', '¼ tsp', '¾ tsp'],
  ['salt eighths', 'salt', '⅛ teaspoon', '⅛ tsp', '¼ tsp'],
  ['lemon juice Tbsp', 'lemon juice', '2 Tablespoons (30ml)', '1 Tablespoon (15ml)', '3 Tbsp (45 ml)'],
  ['milk with ml', 'milk', '1 cup (240ml) whole', '½ cup (120ml) whole', '1½ cups (360 ml) whole'],
  ['milk US + metric', 'milk', '1 cup', '250 ml', '487 ml (about 2 cups + 2¾ tsp)'],
  ['eggs', 'egg', '2 large', '3 large', '5 large'],
  ['eggs plain count', 'egg', '2', '1', '3'],
  ['lemons', 'lemon', '1', '2', '3'],
  ['garlic cloves', 'garlic', '3 cloves', '2 cloves', '5 cloves'],
  ['garlic range', 'garlic', '2-3 cloves', '1 clove', '3–4 cloves'],
  ['cans same size', 'black bean', '1 (15 oz) can', '1 (15 oz) can', '2 (15 oz) cans'],
  ['cans different sizes', 'crushed tomato', '1 (15 oz) can', '1 (28 oz) can', '1 (15 oz) can + 1 (28 oz) can'],
  ['pounds and ounces', 'ground beef', '1 lb', '8 oz', '1½ lb'],
  ['ounces to a pound', 'cheddar', '8 oz', '8 oz', '1 lb'],
  ['odd ounces', 'cheddar', '6 oz', '4 oz', '10 oz'],
  ['grams', 'chocolate', '100g', '250g', '350g'],
  ['grams to kg', 'potato', '1 kg', '500 g', '1.5 kg'],
  ['ml to litres', 'stock', '500 ml', '1 l', '1.5 L'],
  ['oz + grams', 'cream cheese', '8 oz', '100g', '327g (about 11½ oz)'],
  ['weight and volume never mixed', 'flour', '100g', '1 cup', '100g + 1 cup'],
  ['ounces and cups never mixed', 'cheese', '1 cup', '4 oz', '1 cup + 4 oz'],
  ['three recipes', 'sugar', '1 cup', '½ cup', '¼ cup', '1¾ cups'],
  ['three recipes with Tbsp', 'oil', '¼ cup', '2 Tbsp', '1 Tbsp', '¼ cup + 3 Tbsp'],
  ['big batch', 'flour', '4 cups', '4 cups', '4 cups', '12 cups'],
  ['fluid ounces', 'coconut milk', '8 fl oz', '8 fl oz', '16 fl oz'],
  ['fluid ounces and cups', 'milk', '8 fl oz', '1 cup', '2 cups'],
  ['fluid ounces and a spoon', 'cream', '2 fl. oz', '1 Tbsp', '2½ fl oz'],
  ['small boxes', 'instant vanilla pudding', '1 small box', '1 small box', '2 small boxes'],
  ['small and large boxes kept apart', 'instant vanilla pudding', '1 small box', '1 large box', '1 small box + 1 large box'],
  ['jars', 'salsa', '2 jars', '1 jar', '3 jars'],
];

export function runHand(check){
  for(const row of HAND){ const [label, key, ...rest] = row, want = rest.pop(); check(`sum: ${label}`, sum(key, ...rest), want); }
}

// ---------------- the separate calculator ----------------
const F = {'½':1/2,'¼':1/4,'¾':3/4,'⅓':1/3,'⅔':2/3,'⅛':1/8,'⅜':3/8,'⅝':5/8,'⅞':7/8,'⅙':1/6,'⅚':5/6};
const VOL = {floz:6, tsp:1, teaspoon:1, teaspoons:1, tbsp:3, tablespoon:3, tablespoons:3, cup:48, cups:48, stick:24, sticks:24, ml:1/4.92892, l:1000/4.92892};
const WT = {g:1, kg:1000, oz:28.3495, lb:453.592, lbs:453.592};
function number(t){
  t = t.trim(); let m;
  if((m = t.match(/^(\d+)\s*([½¼¾⅓⅔⅛⅜⅝⅞⅙⅚])$/))) return +m[1] + F[m[2]];
  if(F[t] != null) return F[t];
  if((m = t.match(/^(\d+)\/(\d+)$/))) return m[1] / m[2];
  if((m = t.match(/^\d+(\.\d+)?$/))) return +t;
  return null;
}
// returns {v, w, lo, hi} totals in teaspoons and grams (lo/hi for ranges); null if a part can't be read
export function measure(text){
  const out = {v:[0,0], w:[0,0], n:{}};
  const main = String(text).replace(/\s*\(about [^)]*\)$/, '');
  for(let part of main.split(' + ')){
    part = part.replace(/\([^)]*\)/g, ' ').replace(/\bfl\.?\s*oz\b\.?/i, 'floz').replace(/\s+/g, ' ').trim();
    const m = part.match(/^((?:\d+(?:\.\d+)?\s*[½¼¾⅓⅔⅛⅜⅝⅞⅙⅚]?|\d+\/\d+|[½¼¾⅓⅔⅛⅜⅝⅞⅙⅚]))(?:\s*[–-]\s*(\d+(?:\.\d+)?\s*[½¼¾⅓⅔⅛⅜⅝⅞⅙⅚]?|\d+\/\d+|[½¼¾⅓⅔⅛⅜⅝⅞⅙⅚]))?\s*([A-Za-z]*)\s*([A-Za-z]*)$/);
    if(!m) return null;
    const lo = number(m[1]), hi = m[2] ? number(m[2]) : lo; if(lo == null || hi == null) return null;
    const u = m[3].toLowerCase();
    if(VOL[u] != null){ out.v[0] += lo * VOL[u]; out.v[1] += hi * VOL[u]; }
    else if(WT[u] != null){ out.w[0] += lo * WT[u]; out.w[1] += hi * WT[u]; }
    else { const k = u.replace(/s$/, '') || 'each'; out.n[k] = (out.n[k] || [0,0]); out.n[k][0] += lo; out.n[k][1] += hi; }
  }
  return out;
}
// allowed difference: 1%, or rounding to the nearest whole gram / ml, or ⅛ tsp, whichever is bigger
const close = (a, b, floor = 0.15) => Math.abs(a - b) <= Math.max(floor, Math.abs(b) * 0.01);
function agrees(got, want){
  if(!got) return false;
  if(!close(got.v[0], want.v[0]) || !close(got.v[1], want.v[1])) return false;
  if(!close(got.w[0], want.w[0], 0.5) || !close(got.w[1], want.w[1], 0.5)) return false;
  const ks = new Set([...Object.keys(got.n), ...Object.keys(want.n)]);
  for(const k of ks){ const a = got.n[k] || [0,0], b = want.n[k] || [0,0]; if(!close(a[0], b[0]) || !close(a[1], b[1])) return false; }
  return true;
}

// ---------------- random combinations ----------------
const AMTS = ['⅛','¼','⅓','½','⅔','¾','1','1¼','1⅓','1½','1⅔','1¾','2','2½','3','4'];
const SETS = [
  ['tsp','Tbsp','cup'], ['tsp','Tbsp'], ['cup','Tbsp'], ['stick','Tbsp','cup'],
  ['oz','lb'], ['g','kg'], ['ml','l'], ['cup','ml'], ['oz','g'], ['fl oz','Tbsp','cup'], ['clove'], ['large'], [''],
];
export function runRandom(check, n = 400){
  let seed = 20261119; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = a => a[Math.floor(rnd() * a.length)];
  let bad = 0;
  for(let i = 0; i < n; i++){
    const set = pick(SETS), k = 2 + Math.floor(rnd() * 3), parts = [];
    for(let j = 0; j < k; j++){
      const u = pick(set); let a = pick(AMTS);
      if(['g','ml'].includes(u)) a = String(Math.round(10 + rnd() * 490));
      if(['kg','l'].includes(u)) a = pick(['½','1','1½','2']);
      if(['clove','large',''].includes(u)) a = String(1 + Math.floor(rnd() * 4));
      parts.push((a + ' ' + u).trim());
    }
    const key = set[0] === 'stick' ? 'unsalted butter' : 'test';
    const want = measure(parts.join(' + '));
    const got = parts.reduce((x, y) => addQty(x, y, {key}), '');
    const rev = parts.slice().reverse().reduce((x, y) => addQty(x, y, {key}), '');
    const ok = agrees(measure(got), want) && agrees(measure(rev), want);
    if(!ok){ bad++; check(`random: ${parts.join(' + ')}`, `${got} | reversed: ${rev}`, 'a total that matches the calculator'); }
  }
  check(`random: ${n} combinations agree with the separate calculator`, String(n - bad), String(n));
}
