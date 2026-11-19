// Butter Math: shopping-list math checks.
// Run before every change goes to beta or live:  node tests/amounts.test.mjs
// Every line must pass. If one fails, the change does not ship.
import { addQty, splitIngredient, scaleQty, scaleLine, scaleYield } from '../parse.js';

const sum = (...q) => q.reduce((a, b) => addQty(a, b), '');
const butter = (...q) => q.reduce((a, b) => addQty(a, b, {key: 'unsalted butter'}), '');
let failed = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if(!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(44)} ${ok ? got : `got "${got}", expected "${want}"`}`);
};

console.log('\nAdding amounts across recipes');
check('½ cup + ½ cup', sum('½ cup', '½ cup'), '1 cup');
check('⅔ cup + ½ cup + ½ cup', sum('⅔ cup', '½ cup', '½ cup'), '1⅔ cups');
check('1⅔ cups + 2¾ cups (no decimals)', sum('1⅔ cups (209g)', '2¾ cups'), '4⅓ cups + 1 Tbsp + 1 tsp');
check('½ cup + ⅔ cup', sum('½ cup whole', '⅔ cup whole'), '1 cup whole + 2 Tbsp + 2 tsp');
check('1 tsp + 1 tsp', sum('1 teaspoon', '1 tsp'), '2 tsp');
check('2 cups + 1 cup', sum('2 cups', '1 cup'), '3 cups');
check('18 large + 36 large', sum('18 large', '36 large'), '54 large');
check('6 large + 5 (eggs)', sum('6 large', '5'), '11 large');
check('½ cup whole + ½ cup whole', sum('½ cup (120ml) whole', '½ cup (120ml) whole'), '1 cup (240 ml) whole');
check('3 cups (375g) + 1 cup (125g)', sum('3 cups (375g)', '1 cup (125g)'), '4 cups (500g)');

console.log('\nButter in sticks + Tbsp');
check('10 Tbsp + 1 stick', butter('10 Tbsp', '1 stick'), '2 sticks + 2 Tbsp');
check('4 Tbsp + 6 Tbsp + 1 stick', butter('4 tablespoons', '6 Tablespoons (85g)', '1 stick'), '2 sticks + 2 Tbsp');
check('4 Tbsp + 6 Tbsp of butter', butter('4 Tbsp', '6 Tbsp'), '1 stick + 2 Tbsp');
check('2 Tbsp + 3 Tbsp of butter', butter('2 Tbsp', '3 Tbsp'), '5 Tbsp');
check('½ cup + ½ cup of butter', butter('½ cup', '½ cup'), '2 sticks');
check('1 stick + 4 Tbsp', sum('1 stick', '4 Tbsp'), '1 stick + 4 Tbsp');
check('2 sticks + 1 stick', sum('2 sticks', '1 stick'), '3 sticks');
check('peanut butter stays in Tbsp', addQty('4 Tbsp', '6 Tbsp', {key: 'peanut butter'}), '10 Tbsp');

console.log('\nConverting spoons and cups');
check('½ cup + 4 Tbsp', sum('½ cup', '4 Tbsp'), '¾ cup');
check('2 Tbsp + ¼ cup', sum('2 Tbsp', '¼ cup'), '¼ cup + 2 Tbsp');
check('1 cup + 2 Tbsp', sum('1 cup', '2 Tbsp'), '1 cup + 2 Tbsp');
check('1 Tbsp + 3 tsp', sum('1 Tbsp', '3 tsp'), '2 Tbsp');
check('1 Tbsp + 1 tsp', sum('1 Tbsp', '1 tsp'), '1 Tbsp + 1 tsp');
check('½ tsp + 1 Tbsp', sum('½ tsp', '1 Tbsp'), '1 Tbsp + ½ tsp');
check('4 Tbsp + 6 Tbsp (not butter)', sum('4 Tbsp', '6 Tbsp'), '10 Tbsp');

console.log('\nConverting pounds and ounces');
check('1 lb + 8 oz', sum('1 lb', '8 oz'), '1½ lb');
check('2 lb + 12 oz + 4 oz', sum('2 lb', '12 oz', '4 oz'), '3 lb');
check('8 oz (225g) + 1 lb', sum('8 oz (225g)', '1 lb'), '1½ lb');
check('1 lb + 3 oz', sum('1 lb', '3 oz'), '1 lb + 3 oz');

console.log('\nKeeping things apart that should stay apart');
check('1 cup + 1 tsp (no messy 49 tsp)', sum('1 cup', '1 tsp'), '1 cup + 1 tsp');
check('5 Tbsp + 1 tsp', sum('5 Tbsp', '1 tsp'), '5 Tbsp + 1 tsp');
check('1 cup + 4 oz (volume vs weight)', sum('1 cup', '4 oz'), '1 cup + 4 oz');


console.log('\nReading ingredient lines');
const line = (s, name, qty) => { const p = splitIngredient(s); check(`"${s.slice(0, 40)}"`, `${p.name} | ${p.qty}`, `${name} | ${qty}`); };
line('1/2 cup (120ml) whole milk, warmed to about 95°F (35°C)', 'Milk', '½ cup (120ml) whole');
line('1/2 cup (120ml) whole milk (warmed to about 95°F (35°C))', 'Milk', '½ cup (120ml) whole');
line('6 Tablespoons (85g) unsalted butter, softened', 'Unsalted butter', '6 Tablespoons (85g)');
line('2 Tablespoons heavy cream or milk)', 'Heavy cream or milk', '2 Tablespoons');
line('18 large eggs', 'Eggs', '18 large');
line('1 and 2/3 cups (210g) all-purpose flour', 'All-purpose flour', '1⅔ cups (210g)');
line('2 and 1/2 teaspoons baking powder', 'Baking powder', '2½ teaspoons');
line('1 and ½ teaspoons pure vanilla extract', 'Pure vanilla extract', '1½ teaspoons');
line('1 and a half cups milk', 'Milk', '1½ cups');

console.log('\nMatching the same ingredient across recipes');
const same = (a, b) => check(`"${a}" = "${b}"`, String(splitIngredient(a).key === splitIngredient(b).key), 'true');
same('2 large eggs', '1 egg');
same('1 cup whole milk', '½ cup milk');


// Nov 19: the four gaps
check('plus line', JSON.stringify(splitIngredient('1 cup plus 2 tablespoons flour')), JSON.stringify({qty:'1 cup + 2 tablespoons', name:'Flour', key:'flour'}));
check('plus line summed', sum('1 cup + 2 tablespoons', '1 cup'), '2 cups + 2 Tbsp');
check('kg + g', sum('1 kg', '500 g'), '1.5 kg');
check('g + g', sum('100g', '250g'), '350g');
check('ml + L', sum('500 ml', '1 l'), '1.5 L');
check('cup + ml', sum('1 cup', '250 ml'), '487 ml (about 2 cups + 2¾ tsp)');
check('oz + g', sum('8 oz', '100g'), '327g (about 11½ oz)');
check('grams kept', sum('1 cup (200g)', '⅔ cup (135g)'), '1⅔ cups (335g)');
check('grams dropped when one is missing', sum('1 cup (200g)', '2 Tbsp'), '1 cup + 2 Tbsp');
check('ranges', sum('2-3 cloves', '1 clove'), '3–4 cloves');
check('two ranges', sum('2-3 cloves', '1-2 cloves'), '3–5 cloves');
check('can sizes kept apart', sum('1 (15 oz) can', '1 (28 oz) can'), '1 (15 oz) can + 1 (28 oz) can');
check('same can size', sum('1 (15 oz) can', '1 (15 oz) can'), '2 (15 oz) cans');
check('weight and volume never mixed', sum('100g', '1 cup'), '100g + 1 cup');

// Same thing at the store, so one list line (Combine similar items, Nov 19)
const key = l => splitIngredient(l).key;
for(const [a, b] of [['2 tbsp rice wine vinegar', '1 tbsp rice vinegar'], ['3 scallions', '2 green onions'], ["1 cup confectioners' sugar", '1 cup powdered sugar'],
  ['1 can garbanzo beans', '1 can chickpeas'], ['1 tsp bicarbonate of soda', '1 tsp baking soda'], ['1 tbsp corn starch', '1 tbsp cornstarch'],
  ['1 cup heavy whipping cream', '1 cup heavy cream'], ['2 cups plain flour', '2 cups all-purpose flour'], ['1 cup white sugar', '1 cup granulated sugar'],
  ['1 courgette', '1 zucchini'], ['1 aubergine', '1 eggplant'], ['1 cup parmesan cheese', '1 cup parmesan']])
  check('same item: ' + a.replace(/^[^a-z]+/i, '') + ' = ' + b.replace(/^[^a-z]+/i, ''), key(a), key(b));
// Different things never share a line on their own (the list asks first for some of these)
for(const [a, b] of [['1 tsp kosher salt', '1 tsp salt'], ['2 tbsp unsalted butter', '2 tbsp butter'], ['1 cup brown sugar', '1 cup sugar'],
  ['1 cup whipping cream', '1 cup heavy cream'], ['2 tbsp olive oil', '2 tbsp extra virgin olive oil'], ['1 tsp ground coriander', '1 bunch cilantro']])
  check('kept apart: ' + a.replace(/^[^a-z]+/i, '') + ' / ' + b.replace(/^[^a-z]+/i, ''), key(a) === key(b), false);

// Scaling a recipe (½×, 1½×, 2×, 3×, or a serving size). Checked by hand, Nov 19.
console.log('\nScaling a recipe');
for(const [line, f, want] of [
  ['2 cups all-purpose flour', .5, '1 cup all-purpose flour'], ['1 Tbsp olive oil', .5, '1½ tsp olive oil'], ['⅓ cup sugar', .5, '2 Tbsp + 2 tsp sugar'],
  ['1 teaspoon of cinnamon', 3, '1 Tbsp cinnamon'], ['⅓ cup sugar', 1.5, '½ cup sugar'], ['1 Tbsp olive oil', 1.5, '1 Tbsp + 1½ tsp olive oil'],
  ['3 large eggs', 1.5, '4½ large eggs'], ['1 (14 oz) can diced tomatoes', 2, '2 (14 oz) cans diced tomatoes'], ['8 oz cream cheese, softened', 2, '1 lb cream cheese, softened'],
  ['12 oz pasta', 1.5, '1 lb + 2 oz pasta'], ['1 stick butter, melted', .5, '4 Tbsp butter, melted'], ['1 stick butter, melted', 2, '2 sticks butter, melted'],
  ['1 cup (200g) sugar', 1.5, '1½ cups (300g) sugar'], ['1–2 tsp salt', 2, '2–4 tsp salt'], ['about 2 cups broth', 1.5, 'about 3 cups broth'],
  ['1 cup plus 2 tablespoons flour', 2, '2¼ cups flour'], ['1 cup plus 2 tablespoons flour', 3, '3¼ cups + 2 Tbsp flour'], ['200g spinach', 1.5, '300g spinach'],
  ['8 fl oz milk', 1.5, '12 fl oz milk'], ['2 heirloom tomatoes + 4 roma tomatoes', 3, '6 heirloom tomatoes + 12 roma tomatoes'],
  ['1 cup of avocado or grapeseed oil', 2, '2 cups avocado or grapeseed oil'], ['Salt and pepper to taste', 2, 'Salt and pepper to taste'], ['a pinch of salt', 2, 'a pinch of salt'],
  ['2 cups flour', 1, '2 cups flour']])
  check(`scale ${f}×: ${line}`.slice(0, 44), scaleLine(line, f), want);
check('scale: unreadable amount is never shown scaled', scaleQty('2 x 400g', 2), null);
for(const [line, f, want] of [['1 heaping cup flour', 2, '2 heaping cups flour'], ['2 scant cups sugar', .5, '1 scant cup sugar'], ['2 lemons, juiced', .5, '1 lemon, juiced'],
  ['1 red bell pepper, sliced', 2, '2 red bell peppers, sliced'], ['2 large eggs', .5, '1 large egg'], ['1 medium potato', 2, '2 medium potatoes'], ['2 bay leaves', .5, '1 bay leaf'],
  ['2 cherries', .5, '1 cherry'], ['1 bunch cilantro', 2, '2 bunches cilantro'], ['4 slices bacon', .25, '1 slice bacon'], ['2 cloves garlic', .5, '1 clove garlic'], ['1 small zucchini', 2, '2 small zucchini']])
  check(`one or many ${f}×: ${line}`.slice(0, 44), scaleLine(line, f), want);
check('heaping cup is read as a cup', JSON.stringify(splitIngredient('1 heaping cup flour')), '{"qty":"1 cup","name":"Flour","key":"flour"}');
check('serves 4 at 2×', scaleYield('Serves 4', 2), 'Serves 8');
check('4–6 servings at ½×', scaleYield('4–6 servings', .5), '2–3 servings');
// Every scaled spoon/cup amount, read back by a separate counter, is exactly the original times the size
{ const F = {'½':.5,'¼':.25,'¾':.75,'⅓':1/3,'⅔':2/3,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875,'⅙':1/6,'⅚':5/6}, U = {tsp:1, Tbsp:3, cup:48, cups:48};
  const n = t => { const m = t.match(/^(\d*)([½¼¾⅓⅔⅛⅜⅝⅞⅙⅚]?)$/); return (m[1] ? +m[1] : 0) + (m[2] ? F[m[2]] : 0); };
  const tsp = q => q.split(' + ').reduce((a, p) => { const [x, u] = p.trim().split(' '); return a + n(x) * U[u]; }, 0);
  let bad = 0, seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for(let i = 0; i < 500; i++){ const u = ['tsp', 'Tbsp', 'cup'][Math.floor(rnd() * 3)], w = Math.floor(rnd() * 3), fr = ['', '¼', '⅓', '½', '⅔', '¾'][Math.floor(rnd() * 6)];
    const q = (w ? String(w) : '') + fr || '1', f = [.5, 1.5, 2, 3, 1.25, .75][Math.floor(rnd() * 6)], out = scaleQty(q + ' ' + u, f);
    if(!/^(\d*[½¼¾⅓⅔⅛⅜⅝⅞⅙⅚]? (tsp|Tbsp|cups?)( \+ |$))+$/.test(out) || Math.abs(tsp(out) - n(q) * U[u] * f) > 1/16 + 1e-9) bad++; }
  check('500 random spoon and cup sizes, within 1/16 tsp', bad, 0); }

console.log(failed ? `\n${failed} FAILED. Do not ship.\n` : '\nAll checks passed.\n');
process.exit(failed ? 1 : 0);
