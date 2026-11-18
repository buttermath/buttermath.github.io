// Butter Math: shopping-list math checks.
// Run before every change goes to beta or live:  node tests/amounts.test.mjs
// Every line must pass. If one fails, the change does not ship.
import { addQty, splitIngredient } from '../parse.js';

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
check('½ cup whole + ½ cup whole', sum('½ cup (120ml) whole', '½ cup (120ml) whole'), '1 cup whole');
check('3 cups (375g) + 1 cup (125g)', sum('3 cups (375g)', '1 cup (125g)'), '4 cups');

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

console.log(failed ? `\n${failed} FAILED. Do not ship.\n` : '\nAll checks passed.\n');
process.exit(failed ? 1 : 0);
