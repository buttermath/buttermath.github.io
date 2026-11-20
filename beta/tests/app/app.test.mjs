// Butter Math app checks: the real beta app in a real browser (Chromium), with a stand-in database.
// These check what a member actually sees on the shopping list, not just the math behind it.
// Run:  npx playwright install chromium  (once), then  node beta/tests/app/app.test.mjs
// Needs the playwright package (npm i playwright). GitHub runs it in .github/workflows/app-checks.yml.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)); // the repo root, so /beta/ and the shared files load as on the site
const MOCK = await readFile(fileURLToPath(new URL('./mock-database.js', import.meta.url)), 'utf8');
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json'};

// A small local web server. The beta page gets the stand-in database, and no offline helper (it would cache between checks).
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname); if(path.endsWith('/')) path += 'index.html';
  try{
    let body = await readFile(join(ROOT, normalize(path).replace(/^([/\\])+/, '')));
    if(path === '/beta/index.html'){ body = String(body).replace('<script type="module"', '<script>' + MOCK + '</script><script type="module"').replace(/navigator\.serviceWorker\.register/g, '(() => ({catch(){}}))'); }
    res.writeHead(200, {'content-type': TYPES[extname(path)] || 'application/octet-stream'}); res.end(body);
  }catch(e){ res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const URL_ = `http://localhost:${server.address().port}/beta/`;

let failed = 0, total = 0;
const check = (label, got, want) => { total++; const ok = JSON.stringify(got) === JSON.stringify(want); if(!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:      ${JSON.stringify(got)}\n      expected: ${JSON.stringify(want)}`}`); };
const rec = (title, lines) => ({title, ingredients: [{group: '', items: lines}], steps: [{section: '', items: [{title: '', text: 'Mix everything together and cook until done.', timers: []}]}]});

const browser = await chromium.launch(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {});
async function open({seed, mobile} = {}){
  const ctx = await browser.newContext(mobile ? {viewport: {width: 375, height: 740}, isMobile: true, hasTouch: true} : {viewport: {width: 1280, height: 900}});
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.route(/^https?:\/\/(?!localhost)/, r => r.abort()); // nothing leaves the test (fonts, the real database)
  await p.addInitScript(s => { window.__seed = s; }, seed || []);
  await p.goto(URL_);
  if(await p.waitForSelector('[data-act="enter"]', {timeout: 5000}).catch(() => null)) await p.click('[data-act="enter"]');
  for(let i = 0; i < 30 && /Loading/.test(await p.evaluate(() => document.body.innerText)); i++) await p.waitForTimeout(300);
  return {ctx, p, errors};
}
const list = p => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.item')].filter(e => e.offsetParent).map(e => [e.querySelector('.name')?.innerText.trim(), (e.querySelector('.qty')?.innerText || '').trim()])));
async function pick(p, names){ await p.click('[data-act="pickopen"]'); await p.waitForTimeout(300); for(const n of names) await p.locator('[data-act="picktog"]', {hasText: n}).first().click(); await p.click('[data-act="pickgo"]'); await p.waitForTimeout(1000); }

try{
  console.log('\nShopping list adds up across recipes');
  { const {ctx, p, errors} = await open({seed: [rec('Pancakes', ['2 Tbsp butter', '1 cup flour', '2 eggs', '1 cup milk']), rec('Cookies', ['1 stick butter', '2 cups flour', '1 egg', '1 cup sugar']), rec('Omelet', ['3 eggs', '1 Tbsp butter', '¼ cup milk'])]});
    await pick(p, ['Pancakes', 'Cookies', 'Omelet']); const l = await list(p);
    check('butter: 2 Tbsp + 1 stick + 1 Tbsp', l['Butter'], '1 stick + 3 Tbsp');
    check('flour: 1 cup + 2 cups', l['Flour'], '3 cups');
    check('eggs: 2 + 1 + 3 reads "Eggs 6", not "Egg 6"', l['Eggs'], '6');
    check('milk: 1 cup + ¼ cup', l['Milk'], '1¼ cups');
    // removing a recipe takes off only its amounts, and adding it back puts them back exactly
    await p.click('[data-act="chiprm"][aria-label*="Cookies"]'); await p.waitForTimeout(900); const r = await list(p);
    check('remove Cookies: butter', r['Butter'], '3 Tbsp'); check('remove Cookies: flour', r['Flour'], '1 cup'); check('remove Cookies: sugar is gone', r['Sugar'], undefined);
    await pick(p, ['Cookies']); const back = await list(p);
    check('add Cookies back: same list as before', back, l);
    check('no page errors', errors, []); await ctx.close(); }

  console.log('\nOne and many are one line');
  { const {ctx, p} = await open({seed: [rec('Salsa', ['1 tomato', '1 bay leaf', '2 stalks celery']), rec('Stew', ['3 tomatoes', '2 bay leaves', '1 cup celery'])]});
    await pick(p, ['Salsa', 'Stew']); const l = await list(p);
    check('1 tomato + 3 tomatoes', l['Tomatoes'], '4'); check('1 bay leaf + 2 bay leaves', l['Bay leaves'], '3');
    check('celery stays one item', Object.keys(l).filter(k => /celery/i.test(k)), ['Celery']); await ctx.close(); }

  console.log('\nNames on the list follow the amounts');
  { const {ctx, p} = await open({seed: [rec('Soup', ['salt to taste', '1 egg', '2 lemons']), rec('Stew', ['1 tsp salt', '0 eggs', '1 cup broth'])]});
    await pick(p, ['Soup']); let l = await list(p);
    check('one egg reads "Egg 1"', l['Egg'], '1'); check('two lemons', l['Lemons'], '2');
    await pick(p, ['Stew']); l = await list(p);
    check('salt is named from the line with an amount', [l['Salt'], l['Salt to taste']], ['1 tsp', undefined]);
    check('"0 eggs" adds nothing', l['Egg'], '1');
    await p.click('[data-act="chiprm"][aria-label*="Soup"]'); await p.waitForTimeout(900); l = await list(p);
    check('with only "0 eggs" left, eggs show no amount', l['Eggs'] ?? l['Egg'], '');
    await ctx.close(); }

  console.log('\nDouble clicks and junk');
  { const {ctx, p, errors} = await open({seed: [rec('<img src=x onerror="window.__bad=1">Junk', ['', '0 eggs', '1 cup <b>milk</b>', '<script>window.__bad=2</script>1 cup sugar'])]});
    await p.click('[data-act="pickopen"]'); await p.waitForTimeout(300); await p.locator('[data-act="picktog"]').first().click();
    await p.locator('[data-act="pickgo"]').dblclick(); await p.waitForTimeout(1200);
    const names = await p.evaluate(() => [...document.querySelectorAll('.item .name')].map(e => e.innerText));
    check('double-clicking Add adds each item once', names.length, new Set(names).size);
    check('code in a recipe never runs', await p.evaluate(() => window.__bad), undefined);
    check('no page errors', errors, []); await ctx.close(); }

  console.log('\nLosing the connection');
  { const {ctx, p} = await open({seed: [rec('Salsa', ['1 tomato', '1 onion'])], mobile: true});
    await pick(p, ['Salsa']); await p.evaluate(() => { window.__offline = true; });
    await p.locator('[data-act="bought"]').first().click(); await p.waitForTimeout(1500);
    check('nothing saved while offline', await p.evaluate(() => Object.keys(window.__db.kitchens[0].progress.shop || {}).length), 0);
    await p.evaluate(() => { window.__offline = false; }); await p.waitForTimeout(6000);
    check('saved once the connection is back', await p.evaluate(() => Object.keys(window.__db.kitchens[0].progress.shop || {}).length), 1);
    await ctx.close(); }

  console.log('\nPhone screen');
  { const {ctx, p} = await open({seed: [rec('A recipe with a really quite long title for a phone screen', ['2 cups very very very very very very very very long flour name', '1 (14 oz) can diced tomatoes'])], mobile: true});
    await pick(p, ['A recipe']);
    check('nothing runs off the side of a phone', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await ctx.close(); }
}finally{ await browser.close(); server.close(); }

console.log(failed ? `\n${failed} of ${total} app checks FAILED.` : `\nAll ${total} app checks passed.`);
process.exit(failed ? 1 : 0);
