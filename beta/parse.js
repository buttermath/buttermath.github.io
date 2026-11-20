// Pure helpers: turn pasted recipe text into fields, and ingredients into shopping items.

const FRAC = '½¼¾⅓⅔⅛⅜⅝⅞';
const ASCII_FR = {'1/2':'½','1/4':'¼','3/4':'¾','1/3':'⅓','2/3':'⅔','1/8':'⅛','3/8':'⅜','5/8':'⅝','7/8':'⅞'};
export function prettyFractions(s){
  return String(s||'').replace(/(^|[^\d\/])(\d)\/(\d)(?![\d\/])/g,(m,p,a,b)=>ASCII_FR[a+'/'+b]?p+ASCII_FR[a+'/'+b]:m)
    .replace(/(\d) ([½¼¾⅓⅔⅛⅜⅝⅞])/g,'$1$2')
    .replace(/\(\(([^()]*)\)\)/g,'($1)'); // some recipe sites wrap notes in two sets of parentheses
}

const JUNK = /^(print( recipe)?|pin( recipe)?|save( recipe)?|rate( this)?( recipe)?|jump to (recipe|video)|share|email|yum|cook mode|prevent (your )?screen from going dark|us customary|metric|\d(\.\d)?x|\d+x \d+x( \d+x)?|★+☆*|☆+|watch( the)?( video)?|video|equipment|ingredients? ?(list)?$ |course|cuisine|keyword|author|calories|servings? ?:?$|click on the times.*|did you make this.*|leave a (comment|review).*|tap or hover.*|\d+ (reviews?|comments?|ratings?)|.*\bstars? from \d+.*|\(?\d+(\.\d+)? from \d+ (votes|reviews)\)?)$/i;
const ING_HEAD = /^(the )?ingredients?( list)?:?$/i;
const STEP_HEAD = /^(instructions?|directions?|method|steps|preparation|how to make( it)?|to make)( :)?:?$/i;
const END_HEAD = /^(notes?|recipe notes|cook'?s notes|tips|nutrition( information| facts)?|make ahead.*|storage.*|freezing.*|did you make.*|more recipes.*|you may also like.*)( :)?:?$/i;

function metaFrom(line, out){
  const m = line.match(/^(prep(aration)? time|cook(ing)? time|bake time|total time|servings?|yield|makes|serves)\s*:?\s*(.+)$/i);
  if(!m) return false;
  const k = m[1].toLowerCase(), v = m[4].trim();
  if(!v || v.length > 40) return false;
  if(k.startsWith('prep')) out.prep = out.prep || v;
  else if(k.startsWith('cook') || k.startsWith('bake')) out.cook = out.cook || v;
  else if(k.startsWith('total')) out.total = out.total || v;
  else out.yield = out.yield || v;
  return true;
}
const looksIng = l => l.length < 140 && (new RegExp('^(\\d|['+FRAC+']|one |two |three |a |an |pinch|dash|handful|juice of|zest of|salt|pepper|kosher salt|black pepper)','i')).test(l);
const cleanStep = l => l.replace(/^(step\s*)?\d+\s*[.):-]\s*/i,'').replace(/^step\s*\d+\s*/i,'').trim();

// Some recipes (Claude's, and many apps) write each step as a short numbered title, an optional time line like "3m" or "2m 30s",
// then the instructions on the next lines. Join those back into one step: "Heat the pan (3 min). Heat a large skillet…".
const isNumStep = l => /^(step\s*)?\d+\s*[.):-]\s*\S/i.test(l);
const DUR = /^(?:\d+\s*(?:h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)\s*)+$/i;
function durText(l){ return l.match(/\d+\s*[a-z]+/gi).map(x => { const [, n, u] = x.match(/(\d+)\s*([a-z]+)/i); return n + ' ' + (/^h/i.test(u) ? 'hr' : /^m/i.test(u) ? 'min' : 'sec'); }).join(' '); }
function groupSteps(steps){
  const idx = steps.map((l, i) => isNumStep(l) ? i : -1).filter(i => i >= 0);
  if(idx.length < 2) return steps;
  const bodyAfter = i => { let j = i + 1; if(j < steps.length && DUR.test(steps[j])) j++; return j < steps.length && !isNumStep(steps[j]) && !DUR.test(steps[j]); };
  if(idx.filter(bodyAfter).length < Math.ceil(idx.length / 2)) return steps;
  const out = steps.slice(0, idx[0]);
  idx.forEach((s, k) => {
    const end = k + 1 < idx.length ? idx[k + 1] : steps.length;
    const title = cleanStep(steps[s]), rest = steps.slice(s + 1, end);
    const dur = rest.filter(l => DUR.test(l)).map(durText)[0] || '';
    const heads = rest.filter(l => isHead(l)), body = rest.filter(l => !DUR.test(l) && !isHead(l)).join(' ');
    const isTitle = title.length <= 60 && !/[.!?]$/.test(title);
    out.push(!body ? title + (dur ? ` (${dur})` : '') : isTitle ? `${title}${dur ? ` (${dur})` : ''}. ${body}` : `${title}${dur ? ` (${dur})` : ''} ${body}`);
    out.push(...heads);
  });
  return out;
}

export function parseRecipeText(raw){
  const out = {title:'', yield:'', prep:'', cook:'', total:'', ingredients:'', steps:'', notes:''};
  let lines = String(raw||'').split(/\r?\n/)
    .map(l => l.replace(/ /g,' ').replace(/^[\s•▢☐□✓✔\-–*·]+/,'').replace(/\s+/g,' ').trim())
    .filter(Boolean);
  lines = lines.filter(l => !metaFrom(l,out) && !JUNK.test(l));
  let iIng = lines.findIndex(l => ING_HEAD.test(l));
  let iStep = lines.findIndex((l,i) => i > iIng && STEP_HEAD.test(l));
  let ings = [], steps = [], notes = [];
  if(iIng >= 0){
    const endIng = iStep > iIng ? iStep : lines.length;
    ings = lines.slice(iIng+1, endIng);
    if(iStep < 0){ // no instruction heading: split off long sentences
      const firstLong = ings.findIndex(l => !looksIng(l) && l.length > 60);
      if(firstLong >= 0){ steps = ings.slice(firstLong); ings = ings.slice(0, firstLong); }
    }
  } else {
    ings = lines.filter(looksIng);
    steps = lines.filter(l => !looksIng(l) && l.length > 50);
  }
  if(iStep >= 0){
    let rest = lines.slice(iStep+1);
    const iEnd = rest.findIndex(l => END_HEAD.test(l));
    if(iEnd >= 0){ notes = rest.slice(iEnd+1).filter(l => l.length > 15 && l.length < 300 && !/^(calories|fat|carb|protein|sodium|sugar|fiber|cholesterol|serving)/i.test(l)).slice(0,5); rest = rest.slice(0, iEnd); }
    steps = rest;
  }
  const before = iIng > 0 ? lines.slice(0, iIng) : lines;
  out.title = (before.find(l => l.length > 2 && l.length < 80 && !looksIng(l)) || '').replace(/\s*recipe$/i,'');
  ings = ings.filter(l => l.length < 200);
  // A short line ending in ":" or a "For the ..." line is a group heading.
  out.ingredients = ings.map(l => /^for (the )?/i.test(l) && l.length < 50 && !l.endsWith(':') ? l + ':' : l).map(prettyFractions).join('\n');
  out.steps = groupSteps(steps).map(cleanStep).filter(Boolean).map(prettyFractions).join('\n');
  out.notes = notes.join('\n');
  return out;
}

// ---- textarea <-> structured ----
const isHead = l => /:$/.test(l) && l.length < 60;
export function ingTextToGroups(text){
  const groups = []; let cur = {group:'', items:[]};
  String(text||'').split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(l => {
    if(isHead(l)){ if(cur.items.length || cur.group) groups.push(cur); cur = {group:l.replace(/:$/,''), items:[]}; }
    else cur.items.push(prettyFractions(l.replace(BULLET,'')));
  });
  if(cur.items.length || cur.group) groups.push(cur);
  return groups.filter(g => g.items.length);
}
export function groupsToIngText(groups){
  return (groups||[]).map(g => (g.group ? g.group + ':\n' : '') + (g.items||[]).join('\n')).join('\n\n');
}
export function findTimers(text){
  const ms = String(text).match(/(\d+)\s*(?:minutes?|mins?)\s*(?:and\s*)?(\d+)\s*(?:seconds?|secs?)\b/i);
  if(ms){ const n = +ms[1] + +ms[2] / 60; return n > 0 ? [{label: ms[0].replace(/\s+/g,' '), min: n}] : []; }
  const m = String(text).match(/(\d+)(?:\s*(?:-|–|to)\s*\d+)?\s*(minutes?|mins?|hours?|hrs?)\b/i);
  if(!m){ const sx = String(text).match(/(\d+)\s*(?:seconds?|secs?)\b/i); return sx && +sx[1] > 0 ? [{label: sx[0].replace(/\s+/g,' '), min: +sx[1] / 60}] : []; }
  const n = +m[1] * (/^h/i.test(m[2]) ? 60 : 1);
  return n > 0 && n <= 24*60 ? [{label: m[0].replace(/\s+/g,' '), min: n}] : [];
}
export function stepTextToSections(text, old){
  const secs = []; let cur = {section:'', items:[]};
  const prev = {}; (old||[]).forEach(s => (s.items||[]).forEach(st => { prev[st.text] = st; }));
  String(text||'').split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(l => {
    if(isHead(l)){ if(cur.items.length) secs.push(cur); cur = {section:l.replace(/:$/,''), items:[]}; return; }
    const t = prettyFractions(cleanStep(l));
    const p = prev[t];
    cur.items.push(p ? p : {title:'', text:t, timers:findTimers(t)});
  });
  if(cur.items.length) secs.push(cur);
  return secs;
}
export function sectionsToStepText(secs){
  return (secs||[]).map(s => (s.section ? s.section + ':\n' : '') + (s.items||[]).map(st => st.text).join('\n')).join('\n\n');
}

// ---- shopping ----
const UNITS = ['(?:small|medium|large)-(?:small|medium|large)','cups?','c\\.','c','tablespoons?','tbsps?','tbs','tb','tsps?','teaspoons?','ounces?','oz','pounds?','lbs?','grams?','g','gr','kg','kilograms?','ml','milliliters?','liters?','litres?','l','cloves?','cans?','packages?','pkgs?','sticks?','pinch(?:es)?','dash(?:es)?','bunch(?:es)?','heads?','slices?','sprigs?','quarts?','qts?','pints?','containers?','cartons?','bottles?','pouch(?:es)?','jars?','bags?','tins?','packets?','blocks?','bricks?','box(?:es)?','bars?','envelopes?','fl\\.? ?oz','x-large','large','medium','small','whole(?!\\s+(?:or\\b|cloves?(?![A-Za-z])(?!\\s+(?:of\\s+)?garlic)))'];
const Q = '(?:\\d+\\s*['+FRAC+']|\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?|['+FRAC+'])';
const LEAD = new RegExp('^((?:about |approx\\.? )?'+Q+'(?:\\s*(?:-|–|to)\\s*'+Q+')?\\s*(?:\\([^)]*\\)\\s*)?(?:(?:'+UNITS.join('|')+')(?![A-Za-z])\\.?\\s*)?(?:\\([^)]*\\)\\s*)?(?:(?:'+UNITS.join('|')+')(?![A-Za-z])\\.?\\s*)?(?:of\\s+)?)','i');
const DESCRIPTORS = /\b(fresh|freshly|chopped|sliced|diced|minced|softened|chilled|cold|ice[- ]cold|cubed|melted|room temperature|at room temperature|divided|optional|packed|lightly|finely|thinly|roughly|large|small|medium|extra|pure|grated|shredded|whole|to taste|for garnish|for serving|plus more|spooned and leveled|beaten|ground)\b/g;

// Ingredient lines pasted from websites or chats often start with a bullet (•, ◦, ▪, -, *). It isn't part of the item.
export const BULLET = /^[•◦▪▫●○‣∙·*\-–—]+\s*/;
// Names that are the same thing at the store. They share one key, so they add up on one list line.
const SAME_KEY = {'rice wine vinegar':'rice vinegar', 'scallion':'green onion', 'spring onion':'green onion',
  'confectioners sugar':'powdered sugar', 'confectioner sugar':'powdered sugar', 'icing sugar':'powdered sugar',
  'garbanzo bean':'chickpea', 'chick pea':'chickpea', 'bicarbonate of soda':'baking soda', 'bicarb soda':'baking soda',
  'corn starch':'cornstarch', 'heavy whipping cream':'heavy cream', 'plain flour':'all purpose flour', 'ap flour':'all purpose flour',
  'white sugar':'granulated sugar', 'granulated white sugar':'granulated sugar', 'courgette':'zucchini', 'aubergine':'eggplant',
  'parmesan cheese':'parmesan', 'evoo':'virgin olive oil'};
// Names that might be the same thing. The shopping list asks before putting them on one line.
export const MAYBE_SAME = [['olive oil','virgin olive oil'], ['vegetable oil','neutral oil','canola oil'], ['salt','kosher salt','sea salt','table salt','fine sea salt'],
  ['butter','unsalted butter','salted butter'], ['brown sugar','light brown sugar','dark brown sugar'], ['heavy cream','whipping cream'],
  ['flour','all purpose flour'], ['sugar','granulated sugar'], ['parmesan','parmigiano reggiano','parmigiano'], ['onion','yellow onion','white onion'],
  ['soy sauce','tamari'], ['pepper','black pepper']];
export const maybeSame = (a, b) => a !== b && MAYBE_SAME.some(g => g.includes(a) && g.includes(b));
const MODW = '(?:heaping|heaped|scant|level|rounded|generous|(?:lightly |firmly )?packed)';
const MODQ = new RegExp('^([\\d½¼¾⅓⅔⅛⅜⅝⅞][\\d\\/ .½¼¾⅓⅔⅛⅜⅝⅞–-]*?)\\s+' + MODW + '\\s+(?=(?:cups?|c\\.|tablespoons?|tbsps?|tbs|teaspoons?|tsps?|T\\.?|t\\.?)(?![A-Za-z]))', 'i');
export function splitIngredient(line){
  // ".5 cup oil" is 0.5 cup: a decimal written without the 0 in front
  // "4-1/2 teaspoons" (Taste of Home and older cookbooks) is 4½; "one 16-ounce can" is 1 16-ounce can; "Optional: ½ cup corn" is ½ cup corn
  let s = prettyFractions(String(line||'').trim().replace(BULLET,'').replace(/^optional\s*:\s*/i, '').replace(/^(\S+\s+)leaf bay\b/i, '$1bay leaf').replace(/^\.(\d)/, '0.$1')
    .replace(/(^|\()(\d+)-(\d+\/\d+)(?=\s)/g, '$1$2 $3').replace(/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?=\d)/i, (m, w) => NUMW[w.toLowerCase()] + ' ')).replace(/^(\d+)\s+and\s+(\d+\/\d+|[½¼¾⅓⅔⅛⅜⅝⅞])/i, (m, w, f) => w + (/\d/.test(f) ? ' ' : '') + f).replace(/^(\d+)\s+and\s+(?:a\s+)?half\b/i, '$1½');
  let qty = '', name = s;
  // Recipe cards often write T. for tablespoon and t. for teaspoon (capital T is the bigger spoon)
  // "3 garlic cloves" is 3 cloves of garlic, the same item as "2 cloves garlic", so the two add up
  s = s.replace(/^([\d½¼¾⅓⅔⅛⅜⅝⅞][\d\/.½¼¾⅓⅔⅛⅜⅝⅞]*(?:\s*(?:-|–|to)\s*[\d½¼¾⅓⅔⅛⅜⅝⅞][\d\/.½¼¾⅓⅔⅛⅜⅝⅞]*)?)\s+((?:large|medium|small)\s+)?garlic\s+(cloves?)(?![A-Za-z])/i, (m, n, z, c) => n + ' ' + (z || '') + c.toLowerCase() + ' garlic');
  // "1 - 14 oz can of tomatoes" is one 14 oz can, not 1 to 14 cans: a weight or volume right before a container is the container's size
  s = s.replace(/^(\d+)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(oz|ounces?|fl\.? ?oz|g|grams?|kg|ml|l|lbs?|pounds?)\.?\s+(cans?|jars?|packages?|pkgs?|bags?|box(?:es)?|bottles?|containers?|cartons?|tubs?)(?![A-Za-z])/i, (m, n, z, u, c) => +z > +n ? n + ' (' + z + ' ' + u + ') ' + c : m);
  // "1 13.5 oz can coconut milk", "2 15-ounce cans", "2 x 400g tins": a weight or volume right before a container is the container's size,
  // so it's 1 can (13.5 oz), not 1 of something called "13.5 oz can". "10 oz bag frozen peas" with no count is 1 bag.
  { const SZ = '(\\d+(?:\\.\\d+)?[½¼¾⅓⅔⅛⅜⅝⅞]?|[½¼¾⅓⅔⅛⅜⅝⅞]|\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+)\\s*-?\\s*(oz|ounces?|fl\\.?\\s?oz|g|grams?|kg|ml|l|lbs?|pounds?)\\.?', BX = '(cans?|jars?|packages?|pkgs?|bags?|tins?|packets?|blocks?|bricks?|box(?:es)?|bottles?|containers?|cartons?|tubs?)(?![A-Za-z])';
    const U = u => { u = u.toLowerCase().replace(/\s/g, ''); return /^(oz|ounces?)$/.test(u) ? ' oz' : /^fl\.?oz$/.test(u) ? ' fl oz' : /^(lbs?|pounds?)$/.test(u) ? ' lb' : /^(g|grams?)$/.test(u) ? 'g' : /^kg$/.test(u) ? ' kg' : /^ml$/.test(u) ? ' ml' : ' l'; };
    const one = t => t.replace(new RegExp('^(\\d+)(?:\\s*(?:x|×)\\s*|\\s+)' + SZ + '\\s*-?\\s+' + BX, 'i'), (m, n, z, u, c) => /^\d+\/\d+$/.test(z) && !/x|×/i.test(m.slice(n.length, m.indexOf(z))) ? '1 (' + n + ' ' + z + U(u) + ') ' + c : n + ' (' + z + U(u) + ') ' + c)
      .replace(new RegExp('^' + SZ + '\\s*-?\\s+' + BX, 'i'), (m, z, u, c) => '1 (' + z + U(u) + ') ' + c);
    s = s.split(/(\s\+\s)/).map(one).join(''); }
  // "one egg" is 1 egg; "1 lb 8 oz" is 1 lb + 8 oz
  s = s.replace(/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?=\s+[A-Za-z(])/i, w => NUMW[w.toLowerCase()])
    .replace(/^(?:a\s+)?half\s+(?:an?\s+)?(?=[A-Za-z])/i, '½ ').replace(/^(?:a|one)\s+dozen\s+(?=[A-Za-z])/i, '12 ').replace(/^(\d+)\s+dozen\s+(?=[A-Za-z])/i, (m, n) => (+n * 12) + ' ')
    .replace(/^(\d+\s*(?:lbs?|pounds?)\.?)\s+(\d+(?:\.\d+)?\s*(?:oz|ounces?)\.?)(?![A-Za-z])/i, '$1 + $2')
    .replace(/^(\d+\s*(?:cups?)\.?)\s+(\d+\s*(?:tablespoons?|tbsps?|Tbsp|T)\.?)(?![A-Za-z])/, '$1 + $2');
  // "1 heaping cup flour" is 1 cup of flour; the heaping is how to fill the cup, so it stays on the recipe but not in the amount
  s = s.replace(MODQ, '$1 ');
  s = s.replace(/^([\d½¼¾⅓⅔⅛⅜⅝⅞][\d\/ ½¼¾⅓⅔⅛⅜⅝⅞]*?)\s*T\.?(?=\s)/, '$1 Tbsp').replace(/^([\d½¼¾⅓⅔⅛⅜⅝⅞][\d\/ ½¼¾⅓⅔⅛⅜⅝⅞]*?)\s*t\.?(?=\s)/, '$1 tsp'); name = s;
  const m = s.match(LEAD);
  if(m && /\d|[½¼¾⅓⅔⅛⅜⅝⅞]/.test(m[1])){ qty = m[1].trim(); name = s.slice(m[1].length);
    // "1 cup plus 2 tablespoons flour" is one amount: 1 cup + 2 tablespoons
    const pl = name.match(/^(?:plus|\+)\s+/i), m2 = pl && name.slice(pl[0].length).match(LEAD);
    if(m2 && /\d|[½¼¾⅓⅔⅛⅜⅝⅞]/.test(m2[1]) && /[a-z]/i.test(m2[1].replace(/^(about|approx\.?)\s*/i, ''))){ qty = qty + ' + ' + m2[1].trim(); name = name.slice(pl[0].length + m2[1].length); } }
  const rest = name;
  // "1 teaspoon of cinnamon": the "of" belongs to neither the amount nor the name
  qty = qty.replace(/\s+of$/i, '');
  name = name.replace(/^\s*(?:plus|\+)\s+more\s+(?:for\s+[a-z]+\s+)?/i, '');
  while(/\([^()]*\)/.test(name)) name = name.replace(/\([^()]*\)/g,' ');
  name = name.replace(/[()]/g,' ').split(/,| – | - |;/)[0].replace(/\b(plus more|or more|divided|optional)\b.*$/i,'').replace(/\s+/g,' ').trim();
  // "4 roma tomatoes roughly chopped" with no comma: the prep words at the end aren't part of what you buy ("Roma tomatoes")
  { const PREP = '(?:(?:roughly|finely|coarsely|thinly|lightly)\\s+)?(?:chopped|diced|minced|sliced|grated|shredded|crushed|peeled|halved|quartered|cubed|julienned|torn|smashed|trimmed|rinsed|drained|beaten|melted|softened|sifted|toasted)';
    const t = name.replace(new RegExp('\\s+' + PREP + '(?:\\s+(?:and|&)\\s+' + PREP + ')*$', 'i'), ''); if(t && t !== name && /[a-z]/i.test(t)) name = t; }
  // "2 stalks celery", "12 pieces of bacon": the count word belongs with the amount, so the item is Celery or Bacon
  if(qty && !/[a-z]/i.test(qty.replace(/\([^)]*\)/g, ''))){ const cw = name.match(/^(stalks?|ribs?|strips?|pieces?|ears?|packs?)\s+(?:of\s+)?(\S.*)$/i); if(cw){ qty += ' ' + cw[1].toLowerCase(); name = cw[2]; } }
  // "1 Bottle (750 ml Riesling Wine)": when the item is inside the size's parentheses, it's the item
  if(!name){ const pm = qty.match(/^(.*?)\s*\(\s*\d[\d.,]*\s*[a-z]*\.?\s+([^()]*[a-z][^()]*)\)\s*$/i); if(pm){ qty = pm[1]; name = pm[2].trim(); } }
  if(!name) name = s;
  name = name.charAt(0).toUpperCase() + name.slice(1);
  // The key's last word is the same for one or many: tomato/tomatoes, cherry/cherries, bay leaf/bay leaves all share a key
  // Accents don't make a different item (jalapeño, jalapeno), and "whole or 2% milk" is milk
  const key = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g,' ').replace(DESCRIPTORS,' ').replace(/\s+/g,' ').trim().replace(/s$/,'').replace(/ie$/,'y').replace(/oe$/,'o').replace(/ve$/,'f').replace(/^or /, '') || name.toLowerCase();
  // rest: the line after its amount, used to show the line at another recipe size. Not enumerable, so the result's shape is unchanged.
  return Object.defineProperty({qty, name, key: SAME_KEY[key] || key}, 'rest', {value: rest});
}

// "2 heirloom tomatoes + 4 roma tomatoes" is two things to buy, so it becomes two shopping-list items.
// A " + " followed by an amount starts a new ingredient only when every piece names its own ingredient:
// "1 cup + 2 Tbsp flour" stays one amount of flour. The recipe line itself is never changed.
export function ingParts(line){
  const s = String(line || ''), cut = []; let d = 0;
  for(let i = 0; i < s.length; i++){ const ch = s[i]; if(ch === '(') d++; else if(ch === ')') d = Math.max(0, d - 1);
    else if(!d && ch === '+' && /\s$/.test(s.slice(0, i)) && /^\+\s*[\d½¼¾⅓⅔⅛⅜⅝⅞]/.test(s.slice(i))) cut.push(i); }
  if(!cut.length) return [s];
  const parts = []; let from = 0; cut.forEach(i => { parts.push(s.slice(from, i).trim()); from = i + 1; }); parts.push(s.slice(from).trim());
  const named = t => { const x = splitIngredient(t), w = prettyFractions(t.replace(BULLET, '').trim()); return !!x.key && x.qty.length < w.length && /[a-z]/i.test(w.slice(x.qty.length)); };
  return parts.every(named) ? parts : [s];
}
// Puts a changed piece back into its recipe line ("Update the recipe too" on one of two items from the same line).
export function ingReplacePart(line, i, text){ const parts = ingParts(line); if(parts.length < 2) return text; parts[i] = text; return parts.join(' + '); }

export const SECTIONS = ['Produce','Meat & seafood','Dairy & eggs','Bakery & bread','Baking aisle','Pasta, grains & canned','Oils, sauces & condiments','Spices','Frozen','Supplies','Other'];
const W = s => new RegExp('\\b(' + s + ')(e?s)?\\b');
const GUESS = [
  ['Baking aisle', W('cream of tartar|baking powder|baking soda|flour|sugar|yeast|vanilla|extract|cocoa|chocolate|chocolate chip|chip|candy melt|sprinkle|cornstarch|shortening|confectioner|molasses|honey|maple syrup|oat|pecan|walnut|almond|coconut|gelatin|food coloring|marshmallow|graham cracker|peanut butter|corn syrup|raisin|biscuit mix|cake mix|brownie mix|pancake mix|muffin mix')],
  ['Spices', W('cinnamon|nutmeg|allspice|ground ginger|paprika|cumin|oregano|thyme|chili powder|garlic powder|onion powder|cayenne|clove|cardamom|turmeric|coriander|bay leaf|bay leave|red pepper flake|italian seasoning|black pepper|salt|seasoning|curry powder|white pepper|onion granule|garlic granule|dried rosemary|dried sage|ground sage')],
  ['Frozen', W('frozen|ice cream')],
  ['Dairy & eggs', W('milk|butter|cream|cheese|ricotta|mozzarella|parmesan|cheddar|feta|yogurt|egg|buttermilk|half and half')],
  ['Meat & seafood', W('chicken|beef|pork|turkey|sausage|bacon|ham|lamb|steak|shrimp|salmon|fish|tuna|cod|pancetta|prosciutto|hot dog|pepperoni|chuck|scallop|chorizo|salami|meatball|little smokie')],
  ['Produce', W('apple|banana|berry|berrie|blueberry|blueberrie|strawberry|strawberrie|raspberry|raspberrie|lemon|lime|orange|onion|garlic|shallot|bell pepper|pepper|tomato|tomatoe|potato|potatoe|carrot|celery|zucchini|squash|pumpkin|mushroom|spinach|kale|lettuce|cabbage|broccoli|cauliflower|herb|parsley|cilantro|basil|mint|rosemary|scallion|green onion|avocado|cucumber|corn|ginger|fruit|peach|peache|pear|cherry|cherrie|grape|mango|pineapple|jalapeno|jalapeño|asparagus|fennel|chive|leek|tarragon|poblano|serrano|eggplant|radish|beet|dill')],
  ['Bakery & bread', W('bread|bun|roll|tortilla|bagel|pita|naan|croissant|breadcrumb|bread crumb|panko')],
  ['Pasta, grains & canned', W('pasta|noodle|spaghetti|lasagna|macaroni|rice|quinoa|couscous|broth|stock|bean|chickpea|lentil|tomato paste|tomato sauce|crushed tomato|olive')],
  ['Oils, sauces & condiments', W('oil|vinegar|soy sauce|mustard|ketchup|mayo|mayonnaise|hot sauce|worcestershire|sriracha|salsa|dressing|pesto')],
  ['Supplies', W('stick|parchment|foil|plastic wrap|liner|skewer|toothpick|pan|dish')],
];
// Checked before the aisle list, because the list stops at the first word it knows ("tomato" is Produce, "coconut" is Baking aisle).
const CANNED = /\b(broth|stock|bouillon|egg noodles?|clam juice|pizza sauce|marinara|pasta sauce|tomato (?:pur[ée]e|paste|sauce)|passata|fire[- ]roasted tomato|crushed tomato|diced tomato|stewed tomato|whole peeled tomato|coconut (?:milk|cream)|canned)/;
export function guessSection(name, qty){
  const n = String(name).toLowerCase().replace(/-/g, ' ');
  if(/\bdrippings\b/.test(n)) return 'Other';
  if(/\b(?:almond|oat|soy|cashew|rice) milk\b/.test(n)) return 'Dairy & eggs';
  // anything named oil or vinegar ("avocado or grapeseed oil") is with the oils, unless it's packed in oil ("tuna in oil")
  if(/\b(?:oils?|vinegars?)\b/.test(n) && !/\b(?:in|packed in) (?:olive )?oil\b|oil[- ]packed/.test(n)) return 'Oils, sauces & condiments';
  if(CANNED.test(n)) return 'Pasta, grains & canned';
  if(/\bgarlic\b/.test(n) && !/\bgarlic (?:powder|salt|granules|flakes)\b|\bgranulated garlic\b/.test(n)) return 'Produce';
  let sec = 'Other'; for(const [s, re] of GUESS) if(re.test(n)){ sec = s; break; }
  // bought in a can ("1 (14 oz) can black beans"): the canned aisle, unless it's a sauce, or a baking can (condensed or evaporated milk, pumpkin)
  if(/\bcans?\b/i.test(String(qty || ''))){ if(/\b(condensed|evaporated|pumpkin)\b/.test(n)) return 'Baking aisle'; if(sec !== 'Oils, sauces & condiments') return 'Pasta, grains & canned'; }
  return sec;
}

// ---- adding amounts together ("1 large + 2 large" → "3 large") ----
const FV = {'⅙':1/6,'⅚':5/6,'½':.5,'¼':.25,'¾':.75,'⅓':1/3,'⅔':2/3,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875};
const UNIT_NORM = [[/^(cups?|c\.?)$/i,'cup'],[/^(tablespoons?|tbsps?|tbs|tbl|tb)\.?$/i,'Tbsp'],[/^(teaspoons?|tsps?)\.?$/i,'tsp'],[/^floz$/i,'fl oz'],[/^(ounces?|oz)\.?$/i,'oz'],[/^(pounds?|lbs?)\.?$/i,'lb'],[/^(grams?|g|gr)$/i,'g'],[/^(kg|kilograms?)$/i,'kg'],[/^(l|liters?|litres?)$/i,'l'],[/^(ml|milliliters?)$/i,'ml'],[/^(cloves?)$/i,'clove'],[/^(heads?)$/i,'head'],[/^(cans?)$/i,'can'],[/^(sticks?)$/i,'stick'],[/^(jar|bag|package|bottle|container|envelope|carton|tub|tin|packet|block|brick|pouch)(?:e?s)?$/i,'$1'],[/^box(es)?$/i,'box'],[/^(large|medium|small|whole)$/i,'$1'],[/^$/,'']];
function num(s){
  s = s.trim(); let m;
  if((m = s.match(/^(\d+)\s*([½¼¾⅓⅔⅛⅜⅝⅞⅙⅚])$/))) return +m[1] + FV[m[2]];
  if((m = s.match(/^([½¼¾⅓⅔⅛⅜⅝⅞⅙⅚])$/))) return FV[m[1]];
  if((m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + m[2]/m[3];
  if((m = s.match(/^(\d+)\/(\d+)$/))) return m[1]/m[2];
  if((m = s.match(/^\d+(\.\d+)?$/))) return +s;
  return null;
}
function nice(n){
  const whole = Math.floor(n + 1e-9), frac = n - whole;
  const opts = [[0,''],[.125,'⅛'],[1/6,'⅙'],[5/6,'⅚'],[.25,'¼'],[1/3,'⅓'],[.375,'⅜'],[.5,'½'],[.625,'⅝'],[2/3,'⅔'],[.75,'¾'],[.875,'⅞'],[1,'']];
  let best = opts[0]; for(const o of opts) if(Math.abs(o[0] - frac) < Math.abs(best[0] - frac)) best = o;
  const w = best[0] === 1 ? whole + 1 : whole;
  if(Math.abs(best[0] - frac) > .03) return String(Math.round(n * 100) / 100);
  return (w ? String(w) : '') + best[1] || '0';
}
const QDESC = /\s+((?:extra[- ]|x-)?large|medium|small|jumbo|whole|(?:small|medium|large)-(?:small|medium|large))$/i;
const QN = '(\\d+\\s*[½¼¾⅓⅔⅛⅜⅝⅞⅙⅚]|\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞⅙⅚])';
const PART = new RegExp('^' + QN + '(?:\\s*(?:-|–|to)\\s*' + QN + ')?\\s*(\\([^)]*\\))?\\s*([A-Za-z.]*)\\s*(\\([^)]*\\))?$');
// A weight or volume written in parentheses, like "(200g)" or "(240 ml)". Totals keep it when every part has one.
function parenMetric(t){ const m = String(t || '').match(/^\((?:[^)]*[;,]\s*)?(?:about |~)?(\d+(?:\.\d+)?)\s*(g|grams?|kg|ml|milliliters?|l|liters?)\s*\)$/i); if(!m) return null;
  const u = m[2].toLowerCase(), n = +m[1]; return /^k/.test(u) ? {u:'g', v:n * 1000} : /^g/.test(u) ? {u:'g', v:n} : /^(ml|mil)/.test(u) ? {u:'ml', v:n} : {u:'ml', v:n * 1000}; }
function parsePart(p){
  let desc = '', pre = ''; p = String(p).trim().replace(QDESC, (x, d) => { desc = d.toLowerCase(); return ''; })
    // "8 fl oz" is a volume (1 fl oz = 2 Tbsp); "1 small box" keeps its size with the container
    .replace(/\b(?:fl\.?\s*oz\.?|fluid\s+ounces?)(?![A-Za-z])/i, 'floz')
    // "1 whole head" of garlic is 1 head
    .replace(/^(\S+)\s+whole\s+(?=[A-Za-z])/i, '$1 ')
    .replace(/^(\S+)\s+((?:extra[- ])?large|medium|small|jumbo)\s+(?=[A-Za-z])/i, (x, q, d) => { pre = d.toLowerCase(); return q + ' '; });
  const m = p.match(PART);
  if(!m) return null;
  const n = num(m[1]); if(n == null) return null;
  const n2 = m[2] != null ? num(m[2]) : null; if(m[2] != null && (n2 == null || n2 < n)) return null;
  let unit = m[4] || '';
  if(unit.length > 2) unit = unit.toLowerCase();
  for(const [re, u] of UNIT_NORM){ if(re.test(unit)){ unit = unit.replace(re, u); break; } }
  if(pre) unit = unit ? pre + ' ' + unit : pre;
  const pr = m[3] || m[5] || '';
  const box = !unit || /^(?:(?:extra[- ])?large |medium |small |jumbo )?(can|cans|packages?|pkgs?|jars?|bags?|tins?|packets?|blocks?|bricks?|box(es)?|bottles?|containers?|envelopes?|cartons?|tubs?)$/i.test(unit);
  // "2 (400g) tins" is the size of each tin, not a total weight, so it stays with the tin (only a container gets this; "1 cup (200g)" is still a weight)
  const pm = unit && box ? null : parenMetric(pr);
  return {n, n2, unit, desc, pm, size: !pm && pr && box ? pr.replace(/\s+/g, ' ').trim() : ''};
}
export function addQty(a, b, o = {}){
  const mul = o.mul && Math.abs(o.mul - 1) > 1e-9 ? o.mul : 0;
  if(!a) return b || ''; if(!b && !mul) return a;
  const split = t => { const out = []; let d = 0, cur = ''; const s = String(t).replace(/\s*\(about [^()]*\)/g, '');
    for(let i = 0; i < s.length; i++){ const ch = s[i]; if(ch === '(') d++; else if(ch === ')') d = Math.max(0, d - 1);
      if(!d && s.startsWith(' + ', i)){ out.push(cur); cur = ''; i += 2; continue; } cur += ch; } out.push(cur); return out; };
  const parts = b ? split(a).concat(split(b)) : split(a);
  const sums = new Map(), text = [];
  parts.forEach(p => { const x = parsePart(p); if(!x){ if(p.trim()) text.push(p.trim()); return; }
    if(mul){ x.n *= mul; if(x.n2 != null) x.n2 *= mul; if(x.pm) x.pm = {u: x.pm.u, v: x.pm.v * mul}; }
    // a size in parentheses ("1 (15 oz) can") is part of what you buy, so 15 oz and 28 oz cans are counted separately
    const g = (x.unit ? x.unit + '|' + x.desc : '|' + x.desc) + (x.size ? '|' + x.size : ''), s = sums.get(g) || {n:0, hi:0, c:0, orig:p.trim(), unit:x.unit, desc:x.desc, size:x.size, pv:0, pu:null, pok:true};
    s.n += x.n; s.hi += x.n2 != null ? x.n2 : x.n; if(x.n2 != null) s.ranged = true; s.c++; if(!s.desc) s.desc = x.desc;
    if(x.pm && (!s.pu || s.pu === x.pm.u)){ s.pu = x.pm.u; s.pv += x.pm.v; } else s.pok = false; sums.set(g, s); });
  // Different sizes stay apart ("1 large + 1 small", never "2 large"). An amount with no size joins the sized one when there's only one size ("2 large" + "3" = "5 large").
  { const bySize = new Map(); for(const [g, s] of sums) if(!s.unit){ const b = s.size || ''; if(!bySize.has(b)) bySize.set(b, []); bySize.get(b).push(g); }
    for(const gs of bySize.values()){ const bare = gs.find(g => !sums.get(g).desc), sized = gs.filter(g => sums.get(g).desc); if(!bare || sized.length !== 1) continue;
      const s = sums.get(sized[0]), e = sums.get(bare); s.n += e.n; s.hi += e.hi; s.c += e.c; if(e.ranged) s.ranged = true;
      if(s.pok && e.pok && (!s.pu || !e.pu || s.pu === e.pu)){ s.pu = s.pu || e.pu; s.pv += e.pv; } else s.pok = false; sums.delete(bare); } }
  const plural = (u, n) => n > 1 && /(^| )(cup|clove|head|can|stick|jar|bag|package|bottle|container|envelope|carton|tub|tin|packet|block|brick)$/.test(u) ? u + 's' : n > 1 && /(^| )box$/.test(u) ? u + 'es' : u;
  // Spoons, sticks and cups are one family, and so are pounds and ounces. When amounts are added up they're
  // written the way you'd measure them: "4⅓ cups + 1 Tbsp + 1 tsp", never "4.42 cups". Butter goes in
  // sticks + Tbsp ("2 sticks + 2 Tbsp").
  const FAM = {tsp:['v',1], Tbsp:['v',3], 'fl oz':['v',6], stick:['v',24], cup:['v',48], oz:['w',1], lb:['w',16], g:['m',1], kg:['m',1000], ml:['l',1], l:['l',1000]};
  const trim = v => String(Math.round(v * 100) / 100);
  const metric = (t, k) => k === 'm' ? (t >= 1000 ? trim(t / 1000) + ' kg' : (t >= 10 ? Math.round(t) : trim(t)) + 'g') : (t >= 1000 ? trim(t / 1000) + ' L' : (t >= 10 ? Math.round(t) : trim(t)) + ' ml');
  const pmTail = arr => { const u = arr[0].pu; if(!u || arr.some(s => !s.pok || s.pu !== u)) return ''; const v = arr.reduce((n, s) => n + s.pv, 0); return ` (${v >= 10 ? Math.round(v) : trim(v)}${u === 'g' ? 'g' : ' ml'})`; };
  const isButter = /(^| )butter$/.test(o.key || '') && !/(peanut|almond|cashew|apple|sunflower|cocoa|seed|nut) butter$/.test(o.key || '');
  // At a new recipe size, spoon amounts go to the nearest ⅛ tsp, the smallest measuring spoon (off by 1/16 tsp at most)
  const spoons = t => { if(mul && t > 0 && Math.round(t * 8) === 0) return 'a pinch'; if(mul) t = Math.round(t * 8) / 8; const tb = Math.floor(t / 3 + 1e-9), ts = t - tb * 3; return [tb ? tb + ' Tbsp' : '', ts > 1e-6 ? nice(ts) + ' tsp' : ''].filter(Boolean).join(' + ') || '0 tsp'; };
  const cups = t => {
    const w = Math.floor(t / 48 + 1e-9), rem = t - w * 48;
    let best = null; for(const f of [0, 1/4, 1/3, 1/2, 2/3, 3/4]){ const r = rem - f * 48; if(r < -1e-6) continue;
      const score = r < 1e-6 ? 0 : r >= 12 - 1e-6 ? 3 : Math.abs(r / 3 - Math.round(r / 3)) < 1e-6 ? 1 : 2; if(!best || score < best[0] || (score === best[0] && r < best[2] - 1e-6)) best = [score, f, r]; }
    const c = w + best[1], r = best[2] < 1e-6 ? 0 : best[2];
    if(!c) return spoons(t);
    return nice(c) + ' ' + (c > 1 ? 'cups' : 'cup') + (r ? ' + ' + spoons(r) : '');
  };
  // fluid ounces stay in fl oz when the total is an even fraction; otherwise whole fl oz plus spoons, so nothing is rounded away
  const floz = t => { const f = t / 6; if([1, 2, 3, 4, 8].some(d => Math.abs(f * d - Math.round(f * d)) < 1e-6)) return nice(f) + ' fl oz'; const w = Math.floor(f + 1e-9); return (w ? w + ' fl oz + ' : '') + spoons(t - w * 6); };
  const sticks = t => { const s = Math.floor(t / 24 + 1e-9), r = t - s * 24; return s ? `${s} ${s > 1 ? 'sticks' : 'stick'}` + (r > 1e-6 ? ' + ' + spoons(r) : '') : spoons(t); };
  const pounds = (t, top) => { if(top < 16 && t < 16 - 1e-9) return nice(t) + ' oz'; const l = Math.floor(t / 16 + 1e-9), r = t - l * 16;
    if([0, 4, 8, 12].some(x => Math.abs(r - x) < 1e-6)) return nice(t / 16) + ' lb'; return (l ? l + ' lb + ' : '') + nice(r) + ' oz'; };
  const groups = [...sums.values()], byFam = new Map(), merged = new Map();
  groups.forEach(s => { const f = FAM[s.unit]; if(f && !s.ranged && !s.size){ const a = byFam.get(f[0]) || []; a.push(s); byFam.set(f[0], a); } });
  // US and metric amounts of the same kind (1 cup + 250 ml, 8 oz + 100g) are added up exactly in metric, with the US amount after it
  [['v', 'l', 4.92892, 'ml'], ['w', 'm', 28.3495, 'g']].forEach(([us, me, f, mu]) => { const A = byFam.get(us), B = byFam.get(me); if(!A || !B) return;
    const tu = A.reduce((n, s) => n + s.n * FAM[s.unit][1], 0), tm = B.reduce((n, s) => n + s.n * FAM[s.unit][1], 0), all = tm + tu * f, back = all / f;
    const usStr = us === 'w' ? pounds(Math.round(back * 8) / 8, back) : cups(Math.round(back * 4) / 4);
    merged.set(A[0], `${metric(all, me)} (about ${usStr})`); A.slice(1).concat(B).forEach(s => merged.set(s, null)); byFam.delete(us); byFam.delete(me); });
  byFam.forEach(arr => {
    if(!mul && arr.reduce((n, s) => n + s.c, 0) < 2) return;
    const kind = FAM[arr[0].unit][0], used = arr.map(s => s.unit), dd = (arr.find(s => s.desc) || {}).desc, d = dd ? ' ' + dd : '';
    const t = arr.reduce((n, s) => n + s.n * FAM[s.unit][1], 0), top = Math.max(...used.map(u => FAM[u][1]));
    const str = kind === 'm' || kind === 'l' ? metric(t, kind) : kind === 'w' ? pounds(t, top) : used.includes('stick') || (isButter && t >= 24) ? sticks(t) : top >= 48 ? cups(t) : used.includes('fl oz') ? floz(t) : spoons(t);
    merged.set(arr[0], (str + (kind === 'm' || kind === 'l' ? '' : pmTail(arr))).replace(/^([^+]*?)( \+ |$)/, (m, a, b) => a + d + b)); arr.slice(1).forEach(s => merged.set(s, null));
  });
  if(mul && text.length) return null;
  const out = groups.map(s => merged.has(s) ? merged.get(s) : s.c === 1 && !mul ? s.orig : s.ranged ? nice(s.n) + '–' + nice(s.hi) + (s.unit ? ' ' + plural(s.unit, s.hi) : '') + (s.desc ? ' ' + s.desc : '') : nice(s.n) + (s.size ? ' ' + s.size : '') + (s.unit ? ' ' + plural(s.unit, s.n) : '') + (s.desc ? ' ' + s.desc : '') + pmTail([s])).filter(x => x !== null);
  return out.concat(text).join(' + ');
}

// Scaling a recipe (½×, 2×, or a new serving size). Amounts are multiplied exactly and written the way you'd measure them,
// within the same kind of unit only (6 tsp is 2 Tbsp, 4 Tbsp is ¼ cup). Cups never turn into grams.
// Returns null when an amount can't be read, so nothing is ever shown scaled when it isn't.
export function scaleQty(q, f, o = {}){
  if(!q || !f || Math.abs(f - 1) < 1e-9) return q;
  const m = String(q).match(/^((?:about|approx\.?)\s+)(.+)$/i); if(m){ const x = scaleQty(m[2], f, o); return x == null ? null : m[1] + x; }
  return addQty(q, '', Object.assign({}, o, {mul: f}));
}
export function scaleLine(line, f){
  if(!f || Math.abs(f - 1) < 1e-9) return line;
  const out = []; for(const raw of ingParts(line)){ const part = prettyFractions(raw.replace(BULLET, '').trim()), p = splitIngredient(part);
    if(!p.qty){ const x = scaleRest(part, f); if(x == null) return null; out.push(x); continue; }
    const mod = (part.match(new RegExp('^[\\d½¼¾⅓⅔⅛⅜⅝⅞][\\d\\/ .½¼¾⅓⅔⅛⅜⅝⅞–-]*?\\s+(' + MODW + ')\\s+(?=[A-Za-z])', 'i')) || [])[1];
    let pq = p.qty, extra = '';
    if(!/\)\s*(?:cans?|jars?|packages?|pkgs?|bags?|tins?|packets?|blocks?|bricks?|box(?:es)?|bottles?|containers?|cartons?|tubs?)\b/i.test(pq)) pq = pq.replace(/\s*\(([^()]*)\)/g, (m, c) => { if(/(?:^|[;,]\s*)(?:about |~)?[\d.]+\s*(?:g|grams?|kg|ml|l)$/i.test(c.trim())) return m; extra += ' (' + c + ')'; return ''; });
    let q = scaleQty(pq, f, {key: p.key}), rest = String(p.rest || '').trimStart(); if(q == null) return null;
    q = q.replace(/\b((?:extra[- ])?large|medium|small|jumbo|whole)\b/gi, w => (pq.match(new RegExp('\\b' + w + '\\b', 'i')) || [w])[0]); // keep "Whole Milk" capitalized as written
    // after a plain count, a size in parentheses is the size of each one ("1 (3–4 lb) whole chicken"), so it stays as is
    if(extra && /^[\d½¼¾⅓⅔⅛⅜⅝⅞.\/\s–-]+(?:(?:extra[- ])?(?:large|medium|small|jumbo|whole))?$/i.test(pq.trim())){ q = q.replace(/^([\d½¼¾⅓⅔⅛⅜⅝⅞⅙⅚–]+)/, '$1' + extra.replace(/-/g, '–')); extra = ''; }
    else if(extra){ const x = scaleRest(extra.trim(), f); if(x == null) return null; extra = ' ' + x; }
    if(mod && MODQ.test(part)) q = q.replace(/^([\d½¼¾⅓⅔⅛⅜⅝⅞⅙⅚]+(?:–[\d½¼¾⅓⅔⅛⅜⅝⅞⅙⅚]+)?)/, '$1 ' + mod.toLowerCase());
    // a counted thing changes between one and many: "2 lemons" at ½× is "1 lemon", "1 red bell pepper" at 2× is "2 red bell peppers"
    if(/^[\d½¼¾⅓⅔⅛⅜⅝⅞⅙⅚–]+(?: \([^)]*\))?(?: (?:extra[- ])?(?:large|medium|small|jumbo|whole))?(?: \([^)]*\))?$/i.test(q)) rest = countWord(rest, leadNum(q) > 1);
    // the same for a counted unit: "4 slices" at ¼× is "1 slice", "1 bunch" at 2× is "2 bunches"
    else q = q.replace(/^([\d½¼¾⅓⅔⅛⅜⅝⅞⅙⅚–]+ (?:[a-z]+ )?)([a-z]+)(?=$| \+)/i, (m, a, u) => CUNIT.test(u) ? a + plWord(u, leadNum(q) > 1) : m);
    // "1 cup whole + 2 Tbsp" reads better in a recipe as "1 cup + 2 Tbsp whole milk"
    const dm = q.match(/^(.*?) ((?:extra[- ])?large|medium|small|jumbo|whole)( \+ .*)$/i); if(dm){ q = dm[1] + dm[3]; const w = (part.match(new RegExp('\\b' + dm[2] + '\\b', 'i')) || [dm[2]])[0]; rest = w + ' ' + rest; }
    rest = scaleRest(rest, f); if(rest == null) return null;
    // less than ⅛ tsp: "a pinch of cayenne", never "0 tsp"
    if(/^a pinch$/.test(q)) rest = 'of ' + rest.replace(/^of\s+/i, '');
    out.push((q + extra + ' ' + rest).trim()); }
  return out.join(' + ');
}
// Numbers in the rest of a line. Amounts in it are scaled too ("(plus 2 Tbsp for brushing)", "(1 packet)", "juice of 1 lemon").
// Sizes stay ("9-inch", "6-oz fillets", "350°F"). Any other number means the line can't be scaled safely, so it returns null and shows "Not scaled".
const RU = '(?:cups?|tablespoons?|tbsps?|Tbsp|teaspoons?|tsps?|tsp|ounces?|oz|pounds?|lbs?|lb|grams?|g|kg|ml|l|liters?|cloves?|cans?|packets?|packages?|sticks?|pinch(?:es)?|slices?|sprigs?|bunch(?:es)?|heads?|tins?|jars?|bags?)';
const RNUM = t => { t = String(t).trim(); let m; if((m = t.match(/^(\d+)\s*([½¼¾⅓⅔⅛⅜⅝⅞])$/))) return +m[1] + FV[m[2]]; if((m = t.match(/^([½¼¾⅓⅔⅛⅜⅝⅞])$/))) return FV[m[1]];
  if((m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3]; if((m = t.match(/^(\d+)\/(\d+)$/))) return m[1] / m[2]; return /^\d+(\.\d+)?$/.test(t) ? +t : null; };
// a temperature, a percent or a time is never part of the amount: "about 55 degrees" stays 55 at any size
const NOSCALEW = /^(?:degrees?|percent|inch(?:es)?|cm|minutes?|mins?|hours?|hrs?|seconds?|secs?)$/i;
function scaleRest(rest, f){
  let t = String(rest || ''), bad = false;
  const N = '(\\d+(?:\\.\\d+)?\\s*[½¼¾⅓⅔⅛⅜⅝⅞]?|[½¼¾⅓⅔⅛⅜⅝⅞]|\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+)';
  const num = n => { const v = RNUM(n); if(v == null){ bad = true; return null; } return v * f; };
  // an amount with its unit, number only, so "(16 oz)" stays in ounces: "(plus 2 Tbsp for brushing)", "(1 packet)"
  const ADJ = '((?:standard|large|small|medium|heaping|level|scant|full)\\s+)?';
  t = t.replace(new RegExp('(^|[\\s(])' + N + '(?:\\s*[-–]\\s*' + N + ')?\\s*' + ADJ + '(' + RU + ')(?![A-Za-z-])', 'gi'), (m, pre, n, n2, adj, u) => { const v = num(n), v2 = n2 ? num(n2) : null; if(v == null || (n2 && v2 == null)) return m;
    return pre + nice(v) + (n2 ? '–' + nice(v2) : '') + ' ' + (adj || '') + (CUNIT.test(u) ? plWord(u, (v2 || v) > 1) : u); });
  // "juice of 1 lemon", "plus 1 yolk", "about 2 medium"
  t = t.replace(new RegExp('\\b(of|from|plus|and|about)\\s+' + N + '\\s+((?:large|medium|small)\\b|[A-Za-z]+)', 'gi'), (m, w, n, word) => { if(new RegExp('^' + RU + '$', 'i').test(word) || NOSCALEW.test(word)) return m; const v = num(n); if(v == null) return m; return w + ' ' + nice(v) + ' ' + (/^(large|medium|small)$/i.test(word) ? word : plWord(word, v > 1)); });
  if(bad) return null;
  // anything left that's a number but not a size or a temperature: the line can't be scaled safely
  const left = t.replace(new RegExp('(^|[\\s(])' + N + '(?:\\s*[-–]\\s*' + N + ')?\\s*' + ADJ + '(' + RU + ')(?![A-Za-z-])', 'gi'), ' ').replace(/\b(of|from|plus|and|about)\s+[\d.½¼¾⅓⅔⅛⅜⅝⅞⅙⅚]+\s+[A-Za-z]+/gi, ' ')
    .replace(/[\d.½¼¾⅓⅔⅛⅜⅝⅞]+\s*(?:x|×)\s*[\d.]+\s*-?\s*(?:inch|in\.?|cm)\b/gi, ' ').replace(/[\d.\/½¼¾⅓⅔⅛⅜⅝⅞]+\s*-\s*[A-Za-z]+/g, ' ').replace(/[\d.]+\s*(?:-|–|to|or|and)\s*(?=[\d.]+\s*(?:°|degrees|%))/gi, ' ').replace(/[\d.]+\s*(?:°|degrees|%|inch(?:es)?\b|in\.|cm\b|")/gi, ' ');
  if(/[\d½¼¾⅓⅔⅛⅜⅝⅞]/.test(left) || /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|half|quarter)\b/i.test(left.replace(/\b[a-z]+(?:-[a-z]+)+\b/gi, ' '))) return null;
  return t;
}
// "Serves 4" at 2× is "Serves 8"; "4–6 servings" at ½× is "2–3 servings".
// A bigger batch is more pans of the same size, not one giant one, so "one 9-inch pie" at 3× is "3 pies (9-inch)".
const NUMW = {a:1, an:1, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12};
export function scaleYield(y, f){
  if(!y || !f || Math.abs(f - 1) < 1e-9) return y;
  const w = String(y).replace(/^(\D*?)\b(an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?=\s+\S)/i, (x, pre, n) => pre + NUMW[n.toLowerCase()]);
  const m = w.match(/^(\D*?)(\d+(?:\.\d+)?)(?:(\s*(?:-|–|to)\s*)(\d+(?:\.\d+)?))?(.*)$/); if(!m) return y;
  const hi = (m[4] ? +m[4] : +m[2]) * f; let rest = m[5];
  // two separate counts ("Serves 4 as a main or 6 as a side"): scale each number and change no words
  if(/\d/.test(rest.replace(/\d+(?:\s*[x×]\s*\d+)?\s*(?:-?\s?inch|"|-in\.?|\s?cm)/gi, ''))) return w.replace(/(\d+(?:\.\d+)?)(?!\s*(?:[x×]\s*\d|-?\s?inch|"|-in|\s?cm|\.\d))/gi, n => nice(+n * f));
  const sz = rest.match(/^\s+(\d+(?:\s*[x×]\s*\d+)?(?:[- ]inch|"|-in\.?| ?cm)(?![a-z]))\s+(.+)$/i);
  if(sz) rest = ' ' + countWord(sz[2], hi > 1).replace(/^(\S+)/, '$1 (' + sz[1].replace(/\s+/g, ' ') + ')');
  else if(/^\s+\([^)]*\)\s+[a-z]/i.test(rest)){ const pm = rest.match(/^\s+(\([^)]*\))\s+(.+)$/); rest = ' ' + pm[1] + ' ' + countWord(pm[2], hi > 1); }
  else if(/^\s+[a-z]/i.test(rest) && !/^\s+(dozen|to|or|and|people|persons?)\b/i.test(rest)) rest = ' ' + countWord(rest.trim(), hi > 1);
  return m[1] + nice(+m[2] * f) + (m[4] ? m[3] + nice(+m[4] * f) : '') + rest;
}
export function yieldCount(y){ const m = String(y || '').match(/^\D*?(\d+)(?!\s*(?:-|–|to)\s*\d)(?![\d.\/])/); return m ? +m[1] : 0; }

const leadNum = q => { const m = String(q).match(/(\d*)([½¼¾⅓⅔⅛⅜⅝⅞⅙⅚]?)(?=\s|$)(?!.*–)/) || String(q).match(/–(\d*)([½¼¾⅓⅔⅛⅜⅝⅞⅙⅚]?)/); return m ? (m[1] ? +m[1] : 0) + (m[2] ? FV[m[2]] : 0) : 0; };
// The word that's counted: the first word when it's a bunch, sprig, slice and so on ("2 bunches cilantro"), otherwise the last word of the name
// before a comma or note ("2 red bell peppers, sliced"). Words that are the same either way are left alone.
const CUNIT = /^(cups?|cloves?|cans?|packages?|sticks?|pinch|pinches|dash|dashes|bunch|bunches|heads?|slices?|sprigs?|quarts?|pints?|containers?|jars?|bags?|box|boxes|bars?|envelopes?|bottles?|cartons?|tubs?|tins?|packets?|blocks?|bricks?)$/i;
const COUNTED = /^(bunch|bunches|sprigs?|slices?|pieces?|pinch|pinches|handfuls?|stalks?|ribs?|leaf|leaves|sheets?|fillets?|filets?|strips?|cubes?|heads?|cloves?|ears?|links?|loaf|loaves|wedges?|knobs?|dashes|dash|drops?)$/i;
const SAME = /^(zucchini|fish|deer|sheep|asparagus|hummus|couscous|molasses|swiss|grits|oats|greens|series|species|chives|lettuce|garlic|ginger|celery|parsley|cilantro|basil|rice|flour|sugar|salt|butter|cheese|bread|broccoli|spinach|kale|corn|tofu|feta|ricotta|zest|juice|oil|water|milk|cream)$/i;
const IRR = [['leaf', 'leaves'], ['loaf', 'loaves'], ['knife', 'knives'], ['half', 'halves'], ['potato', 'potatoes'], ['tomato', 'tomatoes'], ['mango', 'mangoes']];
function plWord(w, many){
  const lo = w.toLowerCase(), keep = x => w[0] === w[0].toUpperCase() ? x.charAt(0).toUpperCase() + x.slice(1) : x;
  if(SAME.test(lo)) return w;
  for(const [one, more] of IRR){ if(lo === one) return many ? keep(more) : w; if(lo === more) return many ? w : keep(one); }
  if(many){ if(/s$/.test(lo)) return w; if(/[^aeiou]y$/.test(lo)) return w.slice(0, -1) + 'ies'; if(/(ch|sh|x|z)$/.test(lo)) return w + 'es'; return w + 's'; }
  if(!/s$/.test(lo) || /(ss|us|is)$/.test(lo)) return w;
  if(/ies$/.test(lo)) return w.slice(0, -3) + 'y'; if(/(ches|shes|xes|zes)$/.test(lo)) return w.slice(0, -2); return w.slice(0, -1);
}
function countWord(rest, many){
  const m = String(rest).match(/^(\S+)(\s.*)?$/); if(!m) return rest;
  if(COUNTED.test(m[1])) return plWord(m[1], many) + (m[2] || '');
  const cut = rest.search(/\s*(?:[,(;]|\s[-–]\s|\s(?:for|or|to|plus|about)\s)/), head = cut < 0 ? rest : rest.slice(0, cut), tail = cut < 0 ? '' : rest.slice(cut);
  const w = head.match(/^(.*?)([A-Za-z]+)$/); if(!w) return rest;
  return w[1] + plWord(w[2], many) + tail;
}
