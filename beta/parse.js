// Pure helpers: turn pasted recipe text into fields, and ingredients into shopping items.

const FRAC = '½¼¾⅓⅔⅛⅜⅝⅞';
const ASCII_FR = {'1/2':'½','1/4':'¼','3/4':'¾','1/3':'⅓','2/3':'⅔','1/8':'⅛','3/8':'⅜','5/8':'⅝','7/8':'⅞'};
export function prettyFractions(s){
  return String(s||'').replace(/(^|[^\d\/])(\d)\/(\d)(?![\d\/])/g,(m,p,a,b)=>ASCII_FR[a+'/'+b]?p+ASCII_FR[a+'/'+b]:m)
    .replace(/(\d) ([½¼¾⅓⅔⅛⅜⅝⅞])/g,'$1$2');
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
const UNITS = ['(?:small|medium|large)-(?:small|medium|large)','cups?','c\\.','c','tablespoons?','tbsps?','tbs','tsps?','teaspoons?','ounces?','oz','pounds?','lbs?','grams?','g','kg','kilograms?','ml','milliliters?','liters?','litres?','l','cloves?','cans?','packages?','pkgs?','sticks?','pinch(?:es)?','dash(?:es)?','bunch(?:es)?','heads?','slices?','sprigs?','quarts?','pints?','containers?','jars?','bags?','box(?:es)?','bars?','envelopes?','fl\\.? ?oz','large','medium','small','whole'];
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
  'parmesan cheese':'parmesan'};
// Names that might be the same thing. The shopping list asks before putting them on one line.
export const MAYBE_SAME = [['olive oil','virgin olive oil'], ['vegetable oil','neutral oil','canola oil'], ['salt','kosher salt','sea salt','table salt','fine sea salt'],
  ['butter','unsalted butter','salted butter'], ['brown sugar','light brown sugar','dark brown sugar'], ['heavy cream','whipping cream'],
  ['flour','all purpose flour'], ['sugar','granulated sugar'], ['parmesan','parmigiano reggiano','parmigiano'], ['onion','yellow onion','white onion'],
  ['soy sauce','tamari'], ['pepper','black pepper']];
export const maybeSame = (a, b) => a !== b && MAYBE_SAME.some(g => g.includes(a) && g.includes(b));
export function splitIngredient(line){
  let s = prettyFractions(String(line||'').trim().replace(BULLET,'')).replace(/^(\d+)\s+and\s+(\d+\/\d+|[½¼¾⅓⅔⅛⅜⅝⅞])/i, (m, w, f) => w + (/\d/.test(f) ? ' ' : '') + f).replace(/^(\d+)\s+and\s+(?:a\s+)?half\b/i, '$1½');
  let qty = '', name = s;
  // Recipe cards often write T. for tablespoon and t. for teaspoon (capital T is the bigger spoon)
  // "3 garlic cloves" is 3 cloves of garlic, the same item as "2 cloves garlic", so the two add up
  s = s.replace(/^([\d½¼¾⅓⅔⅛⅜⅝⅞][\d\/.½¼¾⅓⅔⅛⅜⅝⅞]*(?:\s*(?:-|–|to)\s*[\d½¼¾⅓⅔⅛⅜⅝⅞][\d\/.½¼¾⅓⅔⅛⅜⅝⅞]*)?)\s+((?:large|medium|small)\s+)?garlic\s+(cloves?)(?![A-Za-z])/i, (m, n, z, c) => n + ' ' + (z || '') + c.toLowerCase() + ' garlic');
  // "1 - 14 oz can of tomatoes" is one 14 oz can, not 1 to 14 cans: a weight or volume right before a container is the container's size
  s = s.replace(/^(\d+)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(oz|ounces?|fl\.? ?oz|g|grams?|kg|ml|l|lbs?|pounds?)\.?\s+(cans?|jars?|packages?|pkgs?|bags?|box(?:es)?|bottles?|containers?|cartons?|tubs?)(?![A-Za-z])/i, (m, n, z, u, c) => +z > +n ? n + ' (' + z + ' ' + u + ') ' + c : m);
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
  if(!name) name = s;
  name = name.charAt(0).toUpperCase() + name.slice(1);
  const key = name.toLowerCase().replace(/[^a-z ]/g,' ').replace(DESCRIPTORS,' ').replace(/\s+/g,' ').trim().replace(/s$/,'') || name.toLowerCase();
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
  ['Baking aisle', W('cream of tartar|baking powder|baking soda|flour|sugar|yeast|vanilla|extract|cocoa|chocolate|chocolate chip|chip|candy melt|sprinkle|cornstarch|shortening|confectioner|molasses|honey|maple syrup|oat|pecan|walnut|almond|coconut|gelatin|food coloring|marshmallow|graham cracker|peanut butter')],
  ['Spices', W('cinnamon|nutmeg|allspice|ground ginger|paprika|cumin|oregano|thyme|chili powder|garlic powder|onion powder|cayenne|clove|cardamom|turmeric|coriander|bay leaf|bay leave|red pepper flake|italian seasoning|black pepper|salt|seasoning|curry powder')],
  ['Frozen', W('frozen|ice cream')],
  ['Dairy & eggs', W('milk|butter|cream|cheese|ricotta|mozzarella|parmesan|cheddar|feta|yogurt|egg|buttermilk|half and half')],
  ['Meat & seafood', W('chicken|beef|pork|turkey|sausage|bacon|ham|lamb|steak|shrimp|salmon|fish|tuna|cod')],
  ['Produce', W('apple|banana|berry|berrie|blueberry|blueberrie|strawberry|strawberrie|raspberry|raspberrie|lemon|lime|orange|onion|garlic|shallot|bell pepper|pepper|tomato|tomatoe|potato|potatoe|carrot|celery|zucchini|squash|pumpkin|mushroom|spinach|kale|lettuce|cabbage|broccoli|cauliflower|herb|parsley|cilantro|basil|mint|rosemary|scallion|green onion|avocado|cucumber|corn|ginger|fruit|peach|peache|pear|cherry|cherrie|grape|mango|pineapple|jalapeno')],
  ['Bakery & bread', W('bread|bun|roll|tortilla|bagel|pita|naan|croissant')],
  ['Pasta, grains & canned', W('pasta|noodle|spaghetti|lasagna|macaroni|rice|quinoa|couscous|broth|stock|bean|chickpea|lentil|tomato paste|tomato sauce|crushed tomato')],
  ['Oils, sauces & condiments', W('oil|vinegar|soy sauce|mustard|ketchup|mayo|mayonnaise|hot sauce|worcestershire|sriracha|salsa|dressing|pesto')],
  ['Supplies', W('stick|parchment|foil|plastic wrap|liner|skewer|toothpick|pan|dish')],
];
// Checked before the aisle list, because the list stops at the first word it knows ("tomato" is Produce, "coconut" is Baking aisle).
const CANNED = /\b(tomato (?:pur[ée]e|paste|sauce)|passata|fire[- ]roasted tomato|crushed tomato|diced tomato|stewed tomato|whole peeled tomato|coconut (?:milk|cream)|canned)/;
export function guessSection(name, qty){
  const n = String(name).toLowerCase();
  // anything named oil ("avocado or grapeseed oil") is with the oils, unless it's packed in oil ("tuna in oil")
  if(/\boils?\b/.test(n) && !/\b(?:in|packed in) (?:olive )?oil\b|oil[- ]packed/.test(n)) return 'Oils, sauces & condiments';
  if(CANNED.test(n)) return 'Pasta, grains & canned';
  if(/\bgarlic\b/.test(n) && !/\bgarlic (?:powder|salt|granules|flakes)\b|\bgranulated garlic\b/.test(n)) return 'Produce';
  let sec = 'Other'; for(const [s, re] of GUESS) if(re.test(n)){ sec = s; break; }
  // bought in a can ("1 (14 oz) can black beans"): the canned aisle, unless it's a sauce, or a baking can (condensed or evaporated milk, pumpkin)
  if(/\bcans?\b/i.test(String(qty || ''))){ if(/\b(condensed|evaporated|pumpkin)\b/.test(n)) return 'Baking aisle'; if(sec !== 'Oils, sauces & condiments') return 'Pasta, grains & canned'; }
  return sec;
}

// ---- adding amounts together ("1 large + 2 large" → "3 large") ----
const FV = {'⅙':1/6,'⅚':5/6,'½':.5,'¼':.25,'¾':.75,'⅓':1/3,'⅔':2/3,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875};
const UNIT_NORM = [[/^(cups?|c\.?)$/i,'cup'],[/^(tablespoons?|tbsps?|tbs|tbl)\.?$/i,'Tbsp'],[/^(teaspoons?|tsps?)\.?$/i,'tsp'],[/^floz$/i,'fl oz'],[/^(ounces?|oz)\.?$/i,'oz'],[/^(pounds?|lbs?)\.?$/i,'lb'],[/^(grams?|g)$/i,'g'],[/^(kg|kilograms?)$/i,'kg'],[/^(l|liters?|litres?)$/i,'l'],[/^(ml|milliliters?)$/i,'ml'],[/^(cloves?)$/i,'clove'],[/^(heads?)$/i,'head'],[/^(cans?)$/i,'can'],[/^(sticks?)$/i,'stick'],[/^(jar|bag|package|bottle|container|envelope|carton|tub)s?$/i,'$1'],[/^box(es)?$/i,'box'],[/^(large|medium|small|whole)$/i,'$1'],[/^$/,'']];
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
const QDESC = /\s+((?:extra[- ])?large|medium|small|jumbo|whole|(?:small|medium|large)-(?:small|medium|large))$/i;
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
  const pr = m[3] || m[5] || '', pm = parenMetric(pr);
  const box = !unit || /^(?:(?:extra[- ])?large |medium |small |jumbo )?(can|cans|packages?|pkgs?|jars?|bags?|box(es)?|bottles?|containers?|envelopes?|cartons?|tubs?)$/i.test(unit);
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
  const plural = (u, n) => n > 1 && /(^| )(cup|clove|head|can|stick|jar|bag|package|bottle|container|envelope|carton|tub)$/.test(u) ? u + 's' : n > 1 && /(^| )box$/.test(u) ? u + 'es' : u;
  // Spoons, sticks and cups are one family, and so are pounds and ounces. When amounts are added up they're
  // written the way you'd measure them: "4⅓ cups + 1 Tbsp + 1 tsp", never "4.42 cups". Butter goes in
  // sticks + Tbsp ("2 sticks + 2 Tbsp").
  const FAM = {tsp:['v',1], Tbsp:['v',3], 'fl oz':['v',6], stick:['v',24], cup:['v',48], oz:['w',1], lb:['w',16], g:['m',1], kg:['m',1000], ml:['l',1], l:['l',1000]};
  const trim = v => String(Math.round(v * 100) / 100);
  const metric = (t, k) => k === 'm' ? (t >= 1000 ? trim(t / 1000) + ' kg' : (t >= 10 ? Math.round(t) : trim(t)) + 'g') : (t >= 1000 ? trim(t / 1000) + ' L' : (t >= 10 ? Math.round(t) : trim(t)) + ' ml');
  const pmTail = arr => { const u = arr[0].pu; if(!u || arr.some(s => !s.pok || s.pu !== u)) return ''; const v = arr.reduce((n, s) => n + s.pv, 0); return ` (${v >= 10 ? Math.round(v) : trim(v)}${u === 'g' ? 'g' : ' ml'})`; };
  const isButter = /(^| )butter$/.test(o.key || '') && !/(peanut|almond|cashew|apple|sunflower|cocoa|seed|nut) butter$/.test(o.key || '');
  // At a new recipe size, spoon amounts go to the nearest ⅛ tsp, the smallest measuring spoon (off by 1/16 tsp at most)
  const spoons = t => { if(mul) t = Math.round(t * 8) / 8; const tb = Math.floor(t / 3 + 1e-9), ts = t - tb * 3; return [tb ? tb + ' Tbsp' : '', ts > 1e-6 ? nice(ts) + ' tsp' : ''].filter(Boolean).join(' + ') || '0 tsp'; };
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
  const out = []; for(const part of ingParts(line)){ const p = splitIngredient(part);
    if(!p.qty){ out.push(part.replace(BULLET, '').trim()); continue; }
    let q = scaleQty(p.qty, f, {key: p.key}), rest = String(p.rest || '').trimStart(); if(q == null) return null;
    // "1 cup whole + 2 Tbsp" reads better in a recipe as "1 cup + 2 Tbsp whole milk"
    const dm = q.match(/^(.*?) ((?:extra[- ])?large|medium|small|jumbo|whole)( \+ .*)$/i); if(dm){ q = dm[1] + dm[3]; rest = dm[2] + ' ' + rest; }
    out.push((q + ' ' + rest).trim()); }
  return out.join(' + ');
}
// "Serves 4" at 2× is "Serves 8"; "4–6 servings" at ½× is "2–3 servings".
export function scaleYield(y, f){
  if(!y || !f || Math.abs(f - 1) < 1e-9) return y;
  const m = String(y).match(/^(\D*?)(\d+(?:\.\d+)?)(?:(\s*(?:-|–|to)\s*)(\d+(?:\.\d+)?))?(.*)$/); if(!m) return y;
  return m[1] + nice(+m[2] * f) + (m[4] ? m[3] + nice(+m[4] * f) : '') + m[5];
}
export function yieldCount(y){ const m = String(y || '').match(/^\D*?(\d+)(?!\s*(?:-|–|to)\s*\d)(?![\d.\/])/); return m ? +m[1] : 0; }
