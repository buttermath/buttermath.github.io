// Butter Math accuracy checks. Run all of them with:  node tests/run.mjs
// GitHub runs this on every change. If anything fails, the change is marked failed and must not go out.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run as runLines, LINES } from './golden-lines.mjs';
import { runHand, runRandom, HAND } from './golden-sums.mjs';
import { run as runReal } from './real-recipes.mjs';

let failed = 0, total = 0;
const check = (label, got, want) => { total++; if(got !== want){ failed++; console.log(`FAIL  ${label}\n      got:      ${got}\n      expected: ${want}`); } };

runLines(check);
runHand(check);
runRandom(check, 1000);
const real = runReal(check);

const here = fileURLToPath(new URL('.', import.meta.url));
const out = execFileSync(process.execPath, [here + 'amounts.test.mjs'], {encoding: 'utf8'});
const fails = (out.match(/^FAIL/gm) || []).length; total += (out.match(/^(PASS|FAIL)/gm) || []).length; failed += fails;
if(fails) console.log(out.split('\n').filter(l => /^FAIL/.test(l)).join('\n'));

console.log(`\nReal recipes: ${real.lines} lines from ${real.recipes} recipes on ${real.sites} sites. ${real.open} known problems still open (KNOWN in real-recipes.mjs).`);
if(real.fixed.length) console.log(`Now reading right, so update the snapshot and remove from KNOWN: ${real.fixed.join(' · ')}`);
console.log(`\n${LINES.length} ingredient lines, ${HAND.length} hand-checked totals, 1000 random totals, and the original checks: ${total - failed} of ${total} passed.`);
if(failed){ console.log(`${failed} FAILED. Do not ship.`); process.exit(1); }
console.log('All checks passed.');
