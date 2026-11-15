import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { STARTERS } from './starter.js';
import { art, guessArt as guessKind } from './art.js?v=11';
import { parseRecipeText, ingTextToGroups, groupsToIngText, stepTextToSections, sectionsToStepText, splitIngredient, guessSection, SECTIONS, prettyFractions, addQty } from './parse.js';

const $ = s => document.querySelector(s);
const app = $('#app');
const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = s => esc(prettyFractions(s)).replace(/([½¼¾⅓⅔⅛⅜⅝⅞])/g, '<span class="fr">$1</span>');
const clone = o => JSON.parse(JSON.stringify(o == null ? {} : o));
const rid = () => Math.random().toString(36).slice(2, 10);
const ARTS = ['pie','lasagna','cakepops','cake','cookies','bread','soup','pasta','bowl'];
const ART_NAMES = {pie:'Pie',lasagna:'Lasagna',cakepops:'Cake pops',cake:'Layer cake',cookies:'Cookies',bread:'Bread',soup:'Soup',pasta:'Pasta',bowl:'Mixing bowl'};
const PALETTE = ['#4B57A8','#D9772B','#D9487A','#3F7A55','#8A5BC2','#B7862F','#2F8A9B','#C8553D'];

/* ---------------- state ---------------- */
let sb = null, session = null, user = null;
let authView = {mode:'signin', msg:'', err:'', busy:false};
let recovering = false;
let recipes = [];            // rows: {id, sort, data}
let kitchen = blankKitchen();
let loaded = false, channel = null;
let ui = {filter:'all', sec:'Other'};
try { ui = Object.assign(ui, JSON.parse(localStorage.getItem('kn-ui') || '{}')); } catch(e) {}
const saveUi = () => { try { localStorage.setItem('kn-ui', JSON.stringify(ui)); } catch(e) {} };

function blankKitchen(){ return {shopping:{sections:SECTIONS.slice(), items:[]}, progress:{shop:{}, active:{}, cook:{}}}; }
function normalize(row){
  const k = blankKitchen();
  if(row){
    if(row.shopping && Array.isArray(row.shopping.items)) k.shopping = {sections: row.shopping.sections && row.shopping.sections.length ? row.shopping.sections : SECTIONS.slice(), items: row.shopping.items};
    if(row.progress) k.progress = Object.assign(k.progress, clone(row.progress));
    ['shop','active','cook'].forEach(x => { if(!k.progress[x] || typeof k.progress[x] !== 'object') k.progress[x] = {}; });
  }
  return k;
}

let statusNow = {kind:'', text:''};
function setStatus(kind, text){ statusNow = {kind, text}; const el = $('#status'); if(!el) return; el.className = 'status ' + kind; el.querySelector('span').textContent = text; }
let toastT; function toast(t, undo){ const el = $('#toast'); el.textContent = t; if(undo){ const b = document.createElement('button'); b.className = 'tundo'; b.textContent = 'Undo'; b.onclick = () => { el.classList.remove('show'); undo(); }; el.appendChild(b); } el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), undo ? 5000 : 2400); }

/* ------------- saving the kitchen row (shopping + progress) -------------
   Each change is a small function. It runs on the local copy right away, and on save
   it runs again on the freshest copy from the server, so two devices don't overwrite each other. */
let queue = [], flushing = false, flushT = null;
function mutate(fn){
  fn(kitchen); render();
  queue.push(fn); clearTimeout(flushT); flushT = setTimeout(flush, 400); setStatus('busy', 'Saving…');
}
async function flush(){
  clearTimeout(flushT);
  if(flushing || !queue.length || !user) return;
  flushing = true; const fns = queue; queue = [];
  try{
    const {data, error} = await sb.from('kitchens').select('*').eq('user_id', user.id).maybeSingle();
    if(error) throw error;
    const fresh = normalize(data);
    fns.forEach(f => f(fresh));
    const {error: e2} = await sb.from('kitchens').upsert({user_id: user.id, shopping: fresh.shopping, progress: fresh.progress, updated_at: new Date().toISOString()});
    if(e2) throw e2;
    kitchen = fresh; queue.forEach(f => f(kitchen));
    flushing = false;
    if(queue.length) flush(); else { setStatus('ok', 'Saved'); render(); }
  }catch(e){
    console.error(e); queue = fns.concat(queue); flushing = false;
    setStatus('err', 'Not saved — retrying'); flushT = setTimeout(flush, 4000);
  }
}
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') flush(); else { reWake(); if(user && !queue.length && !flushing) loadAll(true); } });
window.addEventListener('pagehide', flush);

/* ---------------- boot & auth ---------------- */
async function boot(){
  if(!SUPABASE_URL || /YOUR_/.test(SUPABASE_URL) || !SUPABASE_ANON_KEY || /YOUR_/.test(SUPABASE_ANON_KEY)){
    app.innerHTML = `<div class="card panel" style="max-width:520px;margin:30px auto"><h3>Almost there</h3><p class="muted">This site isn't connected to its database yet. Add your Supabase project URL and anon key to <b>config.js</b> (see README).</p></div>`;
    return;
  }
  const mod = window.__mockSupabase || await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  sb = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange((event, s) => {
    if(event === 'PASSWORD_RECOVERY'){ recovering = true; session = s; user = s && s.user; render(); return; }
    const was = user && user.id;
    session = s; user = s ? s.user : null;
    if(user && user.id !== was) startUser();
    if(!user){ stopUser(); gate = 'gate'; try{ sessionStorage.removeItem('mb-in'); }catch(e){} render(); }
  });
  const {data} = await sb.auth.getSession();
  session = data.session; user = session ? session.user : null;
  if(user) startUser(); else render();
}
function stopUser(){ isAdmin = false; adminData = null; if(channel){ try{ sb.removeChannel(channel); }catch(e){} channel = null; } recipes = []; kitchen = blankKitchen(); loaded = false; queue = []; }
async function startUser(){
  stopUser(); render();
  await loadAll();
  loadFriends(true).then(afterInviteLogin);
  try{
    channel = sb.channel('kitchen-' + user.id)
      .on('postgres_changes', {event:'*', schema:'public', table:'kitchens', filter:'user_id=eq.' + user.id}, p => { if(!queue.length && !flushing && p.new && p.new.user_id){ kitchen = normalize(p.new); render(); } })
      .on('postgres_changes', {event:'*', schema:'public', table:'recipes'}, () => loadRecipes())
      .subscribe();
  }catch(e){ console.warn('realtime off', e); }
}
async function loadRecipes(){
  const {data, error} = await sb.from('recipes').select('id, sort, data').eq('user_id', user.id).order('sort', {ascending:true});
  if(!error){ recipes = data || []; render(); }
}
async function loadAll(quiet){
  if(!quiet) setStatus('busy', 'Loading…');
  try{
    const [r, k] = await Promise.all([
      sb.from('recipes').select('id, sort, data').eq('user_id', user.id).order('sort', {ascending:true}),
      sb.from('kitchens').select('*').eq('user_id', user.id).maybeSingle()
    ]);
    if(r.error) throw r.error; if(k.error) throw k.error;
    recipes = r.data || [];
    if(!queue.length && !flushing) kitchen = normalize(k.data);
    if(!k.data){ await sb.from('kitchens').upsert({user_id: user.id, shopping: kitchen.shopping, progress: kitchen.progress}); }
    loaded = true; setStatus('ok', 'Saved');
    sb.rpc('is_admin').then(({data}) => { const v = data === true; if(v !== isAdmin){ isAdmin = v; render(); } }, () => {});
  }catch(e){ console.error(e); setStatus('err', "Can't reach your kitchen"); loaded = true; }
  render();
}

function renderAuth(){
  const v = authView, m = v.mode;
  if(recovering){
    return `<div class="authwrap"><div class="card panel auth"><h2>Set a new password</h2>
      <form data-form="newpass"><input class="tin" type="password" id="np" placeholder="New password (6+ characters)" minlength="6" required autocomplete="new-password">
      <button class="btn primary big" type="submit">${v.busy ? 'Saving…' : 'Save password'}</button></form>
      ${v.err ? `<div class="err">${esc(v.err)}</div>` : ''}</div></div>`;
  }
  const inv = inviteToken() && inviteInfo && inviteInfo.name && inviteInfo.name !== '__self' ? inviteInfo.name : '';
  const title = inv && m === 'signup' ? `Join ${esc(inv)} on Mixing Bowl` : inv && m === 'signin' ? 'Welcome back' : m === 'signup' ? 'Create your kitchen' : m === 'forgot' ? 'Reset your password' : 'Welcome to <span style="white-space:nowrap">Mixing Bowl!</span>';
  return `<div class="authwrap">
    <div class="authhero">${AUTH_ART}</div>
    <div class="card panel auth">${inv && m !== 'forgot' ? `<div class="invhead">${avatar(inviteInfo.t, inv)}<span>${esc(inv)} invited you</span></div>` : ''}<h2>${title}</h2>
    <p class="muted" style="margin:4px 0 14px">${inv && m === 'signup' ? `Create a free account, then accept ${esc(inv)}'s friend request.` : inv && m === 'signin' ? `Sign in to see ${esc(inv)}'s friend request.` : m === 'signup' ? 'Save recipes, build a shopping list, and follow along step by step on any device.' : m === 'forgot' ? "Enter your email and we'll send you a link." : 'Sign in to view your recipes and shopping list.'}</p>
    <form data-form="${m}">
      ${m === 'signup' ? `<input class="tin" id="au-name" data-keep placeholder="First name" maxlength="40" required autocomplete="given-name">` : ''}
      <input class="tin" id="au-email" data-keep type="email" placeholder="Email" required autocomplete="email">
      ${m !== 'forgot' ? `<input class="tin" id="au-pass" type="password" placeholder="Password${m === 'signup' ? ' (6+ characters)' : ''}" minlength="6" required autocomplete="${m === 'signup' ? 'new-password' : 'current-password'}">` : ''}
      <button class="btn primary big" type="submit" ${v.busy ? 'disabled' : ''}>${v.busy ? 'One sec…' : m === 'signup' ? 'Create account' : m === 'forgot' ? 'Send reset link' : 'Sign in'}</button>
    </form>
    ${m === 'signup' ? `<div class="fine">By creating an account, you confirm you're 13 or older and agree to the <a href="#terms">Terms</a> and <a href="#privacy">Privacy</a> notice.</div>` : ''}
    ${v.err ? `<div class="err">${esc(v.err)}</div>` : ''}${v.msg ? `<div class="ok">${esc(v.msg)}</div>` : ''}
    <div class="authlinks">
      ${m !== 'signin' ? `<button class="linkbtn" data-act="authmode" data-m="signin">${inv ? 'Already on Mixing Bowl? Sign in' : 'I have an account — sign in'}</button>` : `<button class="linkbtn" data-act="authmode" data-m="signup">New here? Create an account</button><button class="linkbtn" data-act="authmode" data-m="forgot">Forgot password?</button>`}
    </div></div></div>`;
}
async function handleAuthForm(kind){
  const email = ($('#au-email') || {}).value, pass = ($('#au-pass') || {}).value, newPass = ($('#np') || {}).value || '';
  authView.err = ''; authView.msg = ''; authView.busy = true; render();
  try{
    if(kind === 'signin'){
      const {error} = await sb.auth.signInWithPassword({email, password: pass}); if(error) throw error;
    } else if(kind === 'signup'){
      const name = ($('#au-name') || {}).value.trim();
      const {data, error} = await sb.auth.signUp({email, password: pass, options:{data:{name}, emailRedirectTo: location.origin + location.pathname}});
      if(error) throw error;
      if(!data.session){ authView.mode = 'signin'; authView.msg = 'Check your email for a confirmation link, then sign in here.'; }
    } else if(kind === 'forgot'){
      const {error} = await sb.auth.resetPasswordForEmail(email, {redirectTo: location.origin + location.pathname}); if(error) throw error;
      authView.msg = 'If that email has an account, a reset link is on its way.';
    } else if(kind === 'newpass'){
      const {error} = await sb.auth.updateUser({password: newPass}); if(error) throw error;
      recovering = false; toast('Password updated'); if(user) startUser();
    }
  }catch(e){
    const msg = (e && e.message) || 'Something went wrong.';
    authView.err = /invalid login/i.test(msg) ? "That email and password don't match." : /already registered/i.test(msg) ? 'That email already has an account. Try signing in.' : /rate limit/i.test(msg) ? 'Too many emails sent recently. Please wait a bit and try again.' : msg;
  }
  authView.busy = false; render();
}

/* ---------------- helpers ---------------- */
const R = id => recipes.find(r => r.id === id);
const D = r => (r && r.data) || {};
const P = () => kitchen.progress;
const isArch = id => !!(P().archived || {})[id];
const isActive = id => P().active[id] !== false && !isArch(id);
function stepList(d){ const out = []; (d.steps || []).forEach((sec, si) => (sec.items || []).forEach((st, k) => out.push({key: si + '-' + k, st}))); return out; }
function cookOf(id){ const c = P().cook[id] || {}; return {i: c.i || {}, s: c.s || {}}; }
function progressOf(r){ const all = stepList(D(r)); const c = cookOf(r.id); const done = all.filter(x => c.s[x.key]).length; return {total: all.length, done, cur: all.findIndex(x => !c.s[x.key]), all}; }
const allItems = () => kitchen.shopping.items || [];
const onList = id => isActive(id) && !(P().done || {})[id] && allItems().some(i => (i.recipes || []).includes(id));
const visibleItems = () => allItems().filter(it => !it.recipes || !it.recipes.length || it.recipes.some(x => R(x) ? isActive(x) : false) || (it.custom && !it.recipes.some(x => R(x))));
const firstName = () => ((user && user.user_metadata && user.user_metadata.name) || '').trim();
const artText = d => [d.title || ''].concat((d.ingredients || []).flatMap(g => g.items || [])).join('\n');
const kindOf = d => { const k = guessArt(d.title || ''); return k !== 'bowl' ? k : (d.art || 'bowl'); };
const pic = d => d.photo ? `<img src="${esc(d.photo)}" alt="" loading="lazy">` : art(kindOf(d), artText(d));

function addIngredientsTo(k, recipeId, groups){
  const items = k.shopping.items; const touched = new Set();
  (groups || []).forEach(g => (g.items || []).forEach(line => {
    const {qty, name, key} = splitIngredient(line); if(!key) return;
    let it = items.find(i => (i.key || splitIngredient(i.name).key) === key);
    if(it){
      const linked = (it.recipes || []).includes(recipeId);
      if(linked && !touched.has(it.id)) return;
      if(!linked) it.recipes = (it.recipes || []).concat(recipeId);
      if(qty) it.qty = addQty(it.qty, qty);
      touched.add(it.id);
    } else {
      const id = 'i-' + recipeId.slice(0, 8) + '-' + key.replace(/[^a-z0-9]+/g, '-').slice(0, 30);
      items.push({id, name, qty, key, section: guessSection(name), recipes:[recipeId]});
      touched.add(id);
    }
  }));
}
function removeRecipeFrom(k, recipeId){
  k.shopping.items = k.shopping.items.map(it => Object.assign(it, {recipes: (it.recipes || []).filter(x => x !== recipeId)})).filter(it => it.custom || it.recipes.length);
  delete k.progress.cook[recipeId]; delete k.progress.active[recipeId]; if(k.progress.done) delete k.progress.done[recipeId];
}

/* ---- cooking rounds: made count, fresh list adds ---- */
const legacyDone = id => { const r = R(id); if(!r) return false; const all = stepList(D(r)); const o = P().cook[id] || {}; return all.length > 0 && !o.counted && all.every(x => (o.s || {})[x.key]); };
const madeOf = id => { const m = ((P().made || {})[id]) || {n:0}; return legacyDone(id) ? Object.assign({}, m, {n: (m.n || 0) + 1}) : m; };
function bankLegacy(k, id){ const r = R(id); if(!r) return; const all = stepList(D(r)); const o = k.progress.cook[id] || {}; if(all.length && !o.counted && all.every(x => (o.s || {})[x.key])){ const m = k.progress.made = k.progress.made || {}; const c = m[id] || {n:0}; m[id] = {n: (c.n || 0) + 1, last: c.last || ''}; } }
function syncMade(k, id){
  const r = R(id); if(!r) return; const all = stepList(D(r)); const o = k.progress.cook[id] = k.progress.cook[id] || {};
  const full = all.length > 0 && all.every(x => (o.s || {})[x.key]);
  const m = k.progress.made = k.progress.made || {};
  if(full && !o.counted){ o.counted = true; const c = m[id] || {n:0}; m[id] = {n: (c.n || 0) + 1, last: new Date().toISOString().slice(0, 10)}; }
  else if(!full && o.counted){ o.counted = false; const c = m[id] || {n:0}; m[id] = Object.assign({}, c, {n: Math.max(0, (c.n || 0) - 1)}); }
}
const ingLines = d => (d.ingredients || []).flatMap(g => g.items || []).filter(l => splitIngredient(l).key);
function unlinkRecipe(k, id, keys){
  const marks = k.progress.shop = k.progress.shop || {};
  k.shopping.items = k.shopping.items.filter(i => {
    if(!(i.recipes || []).includes(id)) return true;
    if(keys && !keys.has(i.key || splitIngredient(i.name).key)) return true;
    i.recipes = i.recipes.filter(x => x !== id);
    if(i.recipes.length || i.custom) return true;
    delete marks[i.id]; return false;
  });
}
function addFresh(k, id, lines){
  if(!(k.progress.active[id] !== false && !(k.progress.archived || {})[id] && !(k.progress.done || {})[id])) unlinkRecipe(k, id);
  addIngredientsTo(k, id, [{items: lines}]);
  const keys = new Set(lines.map(l => splitIngredient(l).key));
  const marks = k.progress.shop = k.progress.shop || {};
  k.shopping.items.forEach(i => { if((i.recipes || []).includes(id) && keys.has(i.key || splitIngredient(i.name).key)) delete marks[i.id]; });
  k.progress.active[id] = true; if(k.progress.done) delete k.progress.done[id];
  if(k.progress.archived) delete k.progress.archived[id];
}
const ingListed = (id, line) => { const key = splitIngredient(line).key; return allItems().some(i => (i.recipes || []).includes(id) && (i.key || splitIngredient(i.name).key) === key && !P().shop[i.id]) && isActive(id) && !(P().done || {})[id]; };
let addSheet = null, choosing = null, chosenN = 0, moreOpen = false, shopQ = '';
const hostOf = u => { try{ return new URL(u).hostname.replace(/^www\./, ''); }catch(e){ return 'website'; } };
const ICON_PEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';
const ICON_MORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';

/* ---------------- render ---------------- */
function route(){
  const h = (location.hash || '').slice(1);
  if(h.startsWith('r-')) return {v:'recipe', id:h.slice(2)};
  if(h.startsWith('fr-')) return {v:'frecipe', id:h.slice(3)};
  if(h.startsWith('f-')) return {v:'fbook', id:h.slice(2)};
  if(h.startsWith('invite-')) return {v:'invite', id:h.slice(7)};
  if(h.startsWith('edit-')) return {v:'form', id:h.slice(5)};
  if(h === 'add') return {v:'form'};
  if(['recipes','friends','account','settings','privacy','trips','admin','terms','feedback','help'].includes(h)) return {v:h};
  return {v:'shopping'};
}
// ---------- friends & shared cookbooks ----------
let fCat = [], fCatOpen = false, fSortOpen = false, fSortK = 'recent';
const FSORTS = {recent:'Recent', az:'A–Z'};
let friends = null, inbox = [], friendsAt = 0, addFriendOpen = false, sendSheet = null, fbook = {}, fQ = '', inviteInfo = null;
const ICON_ADDF = '<svg class="bi" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M19 8v6M16 11h6"/></svg>';
const ICON_LINK = '<svg class="bi" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
const ICON_LOCK = '<svg class="bi" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const ICON_PLUS2 = '<svg class="bi" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_OK = '<svg class="bi" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_SEND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/></svg>';
const ICON_RIGHT = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const AVC = ['#C8553D', '#4B57A8', '#3F7A55', '#B5142B', '#D9772B', '#6E4FA8'];
const avColor = id => AVC[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVC.length];
const avatar = (id, name, cls = '') => `<span class="av ${cls}" style="--a:${avColor(id)}">${esc((name || '?').trim().charAt(0).toUpperCase())}</span>`;
const kitchenOf = n => `${n}'s Kitchen`;
const isPriv = id => !!(P().private || {})[id];
const friendBy = id => (friends || []).find(f => f.friend_id === id);
const savedFrom = f => recipes.filter(r => { const s = D(r).savedFrom; return s && (s.owner === f.friend_id || (!s.owner && s.name === f.name)); });
const savedCopy = (fid, rid) => recipes.find(r => (D(r).savedFrom || {}).id === rid);
const friendsNew = () => (friends || []).filter(f => f.status === 'pending' && f.incoming).length + inbox.length;

async function loadFriends(force){
  if(!user || (!force && Date.now() - friendsAt < 20000)) return;
  friendsAt = Date.now();
  const [f, i] = await Promise.all([sb.rpc('my_friends'), sb.rpc('my_inbox')]);
  if(!f.error) friends = f.data || []; else if(friends === null) friends = [];
  if(!i.error) inbox = i.data || [];
  render();
}
async function loadFbook(fid){
  fbook[fid] = {loading: true, rows: (fbook[fid] || {}).rows || []}; render();
  const {data, error} = await sb.rpc('friend_recipes', {friend: fid});
  fbook[fid] = {loading: false, rows: data || [], err: !!error}; render();
}

function renderFriends(){
  if(friends === null){ loadFriends(true); return `<div class="grid"><div class="skeleton"></div><div class="skeleton"></div></div>`; }
  const inc = friends.filter(f => f.status === 'pending' && f.incoming), acc = friends.filter(f => f.status === 'accepted'), out = friends.filter(f => f.status === 'pending' && !f.incoming);
  const n = inc.length + inbox.length;
  const isEmpty = !acc.length && !n && !out.length;
  const head = `<div class="fr-h"><h2>Friends</h2>${isEmpty ? '' : `<button class="btn primary sm" data-act="addfriend">${ICON_ADDF}Add friend</button>`}</div>`;
  const reqs = inc.map(f => `<div class="fcard"><div class="frow">${avatar(f.friend_id, f.name)}<div class="ftx"><b>${esc(f.name)} wants to share cookbooks</b><span>You'll be able to see each other's recipes</span></div></div>
    <div class="fbtns"><button class="btn primary" data-act="fraccept" data-id="${esc(f.friend_id)}">Accept</button><button class="btn outline" data-act="frdecline" data-id="${esc(f.friend_id)}">Decline</button></div></div>`).join('');
  const shares = inbox.map(s => `<div class="fcard"><div class="frow"><span class="thumb" style="--c:${esc(s.data.color || '#888')}">${pic(s.data)}</span><div class="ftx"><span>${esc(s.sender_name)} sent you a recipe</span><b>${esc(s.data.title || 'A recipe')}</b></div></div>
    ${s.note ? `<div class="note">“${esc(s.note)}”</div>` : ''}
    <div class="fbtns"><button class="btn primary" data-act="shsave" data-id="${esc(s.id)}">${ICON_PLUS2}Save recipe</button><button class="btn outline" data-act="shdismiss" data-id="${esc(s.id)}">Dismiss</button></div></div>`).join('');
  const books = acc.map(f => `<div class="cbk crow" role="link" tabindex="0" data-act="go" data-h="f-${esc(f.friend_id)}" aria-label="Open ${esc(kitchenOf(f.name))}">${avatar(f.friend_id, f.name)}<span class="ftx"><b>${esc(kitchenOf(f.name))}</b><span>${f.recipes} recipe${f.recipes == 1 ? '' : 's'}</span></span><button class="rmfr2" data-act="frremove" data-id="${esc(f.friend_id)}" aria-label="Remove ${esc(f.name)} as a friend" title="Remove friend"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 11h6"/></svg></button></div>`).join('');
  const waiting = out.map(f => `<div class="cbk wait">${avatar(f.friend_id, f.name)}<span class="ftx"><b>${esc(f.name)}</b><span>Waiting for them to accept</span></span><button class="linkbtn" data-act="frcancel" data-id="${esc(f.friend_id)}">Cancel</button></div>`).join('');
  const empty = isEmpty ? `<div class="card empty frempty"><b>Share cookbooks with friends and family</b><span>When they accept, you can browse each other's recipes and save their recipes to your cookbook.</span><button class="btn primary" data-act="addfriend">${ICON_ADDF}Add friend</button></div>` : '';
  return head + (n ? `<div class="fr-sec">New <span class="dotn">${n}</span></div>${reqs}${shares}` : '')
    + (acc.length ? `<div class="fr-sec">Cookbooks</div>${books}` : '') + (out.length ? `<div class="fr-sec">Sent requests</div>${waiting}` : '') + empty
    + (addFriendOpen ? renderAddFriend() : '');
}
function renderAddFriend(){
  return `<div class="sheetbg" data-act="addfriendclose"></div><div class="asksheet frsheet" role="dialog" aria-label="Add a friend"><div class="askt">Add a friend</div>
    <form class="emrow" data-form="frsend"><input class="tin" id="fr-email" data-keep type="email" inputmode="email" autocomplete="off" placeholder="Friend's email" required><button class="btn primary" type="submit">Send</button></form>
    <div class="frhint">They'll see your request in their Friends tab.</div>
    <div class="ordiv">or</div>
    <button class="btn outline bigbtn" data-act="frlink">${ICON_LINK}Share invite link</button>
    <div class="frhint">For friends who aren't on Mixing Bowl yet.</div></div>`;
}
function fTile(fid, row){
  const d = row.data || {}, saved = savedCopy(fid, row.id), tt = autoTags(d).slice(0, 3);
  return `<div class="tile" role="link" tabindex="0" style="--c:${esc(d.color || '#888')}" data-act="go" data-h="fr-${esc(fid)}~${esc(row.id)}" data-q="${esc((d.title + ' ' + autoTags(d).join(' ')).toLowerCase())}">
    <span class="art">${pic(d)}</span>${saved ? `<span class="savebtn done">${ICON_OK}Saved</span>` : `<button class="savebtn" data-act="fsave" data-f="${esc(fid)}" data-id="${esc(row.id)}">${ICON_PLUS2}Save</button>`}
    <span class="body">${tt.length ? `<span class="ttags">${tt.map(t => `<i>${esc(t)}</i>`).join('')}</span>` : ''}<h2>${esc(d.title)}</h2><span class="meta">${d.yield ? `<span>${ICON_SERV}${esc(d.yield)}</span>` : ''}${d.total ? `<span>${ICON_TIME}${esc(d.total)}</span>` : ''}</span></span></div>`;
}
function renderFbook(fid){
  const f = friendBy(fid);
  if(friends === null){ loadFriends(true); return `<div class="grid"><div class="skeleton"></div></div>`; }
  if(!f || f.status !== 'accepted') return `<button class="back" data-act="go" data-h="friends">← Friends</button><div class="card empty">This cookbook isn't shared with you.</div>`;
  const b = fbook[fid]; if(!b) { setTimeout(() => loadFbook(fid)); }
  const rows = (b && b.rows) || [];
  return `<button class="back" data-act="go" data-h="friends">← Friends</button>
    <div class="fbanner">${avatar(fid, f.name)}<span class="ftx"><b>${esc(kitchenOf(f.name))}</b><span>${rows.length || f.recipes} recipe${(rows.length || f.recipes) == 1 ? '' : 's'}</span></span></div>
    ${rows.length > 4 ? `<div class="rsearch"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4.5 4.5"></path></svg><input id="fsearch" data-keep type="search" placeholder="Search ${esc(f.name)}'s recipes" autocomplete="off"></div>` : ''}
    ${rows.length > 1 ? fFilterBar(rows) : ''}
    ${!b || b.loading && !rows.length ? `<div class="grid"><div class="skeleton"></div><div class="skeleton"></div></div>` : b.err ? `<div class="card empty">Couldn't load this cookbook. Try again in a moment.</div>` : rows.length ? fGrid(fid, rows) : `<div class="card empty">${esc(f.name)} hasn't shared any recipes yet.</div>`}`;
}
function fFilterBar(rows){
  const counts = {}; rows.forEach(r => autoTags(r.data || {}).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
  const cats = Object.keys(counts).sort((x, y) => x.localeCompare(y)); fCat = fCat.filter(t => counts[t]);
  const on = fCat.length > 0, hasAll = (r, list) => { const tg = autoTags(r.data || {}); return list.every(t => tg.includes(t)); };
  return `<div class="fbar2"><div class="fwrap"><button class="fpill ${on ? 'act' : ''}" data-act="fcatmenu" aria-haspopup="true" aria-expanded="${fCatOpen}">Category${on ? `<span class="fcount">${fCat.length}</span>` : ''}${ICON_CHEV}</button>
    ${fCatOpen ? `<div class="fmenu" role="group" aria-label="Categories"><button class="fall ${!on ? 'on' : ''}" data-act="fcatclear">All categories <span>${rows.length}</span></button>${cats.map(t => { const o = fCat.includes(t); const n = o ? rows.filter(r => hasAll(r, fCat)).length : rows.filter(r => hasAll(r, fCat.concat(t))).length; return `<button class="fck ${o ? 'on' : ''} ${!o && !n ? 'dim' : ''}" data-act="fcatpick" data-t="${esc(t)}" role="checkbox" aria-checked="${o}"><i class="cb">${o ? CHECK : ''}</i><b>${esc(t)}</b><span>${o ? '' : n}</span></button>`; }).join('')}</div>` : ''}</div>
    <div class="fwrap fright"><button class="fpill sortp" data-act="fsortmenu" aria-haspopup="menu" aria-expanded="${fSortOpen}" aria-label="Sort: ${FSORTS[fSortK]}">${ICON_SORT}${FSORTS[fSortK]}</button>
    ${fSortOpen ? `<div class="fmenu right" role="menu">${Object.entries(FSORTS).map(([k, l]) => `<button role="menuitem" class="${k === fSortK ? 'on' : ''}" data-act="fsortpick" data-k="${k}">${l}${k === fSortK ? '<span>✓</span>' : ''}</button>`).join('')}</div>` : ''}</div></div>
    ${on ? `<div class="selchips">${fCat.map(t => `<span class="selchip">${esc(t)}<button data-act="fcatpick" data-t="${esc(t)}" aria-label="Remove ${esc(t)} filter">✕</button></span>`).join('')}${fCat.length > 1 ? `<button class="clearall" data-act="fcatclear">Clear all</button>` : ''}</div>${fCat.length > 1 ? `<div class="fnote">Showing recipes with ${fCat.length === 2 ? 'both' : 'all ' + fCat.length} tags</div>` : ''}` : ''}`;
}
function fGrid(fid, rows){
  const tg = r => autoTags(r.data || {});
  let shown = rows.filter(r => fCat.every(t => tg(r).includes(t)));
  if(fSortK === 'az') shown = shown.slice().sort((a, b) => (a.data.title || '').localeCompare(b.data.title || ''));
  return `<div class="grid" id="fgrid">${shown.map(r => fTile(fid, r)).join('')}</div><div class="card empty" id="fnone" ${shown.length ? 'hidden' : ''}>No recipes match.</div>`;
}
function renderFrecipe(key){
  const [fid, rid] = key.split('~'), f = friendBy(fid), b = fbook[fid];
  if(friends === null){ loadFriends(true); return `<div class="grid"><div class="skeleton"></div></div>`; }
  if(!b){ setTimeout(() => loadFbook(fid)); return `<div class="grid"><div class="skeleton"></div></div>`; }
  const row = (b.rows || []).find(r => r.id === rid);
  if(!f || !row) return `<button class="back" data-act="go" data-h="${f ? 'f-' + esc(fid) : 'friends'}">← Back</button><div class="card empty">${b.loading ? 'Loading…' : "This recipe isn't shared anymore."}</div>`;
  const d = row.data, saved = savedCopy(fid, rid);
  const ings = (d.ingredients || []).map(g => (g.group ? `<div class="grp">${esc(g.group)}</div>` : '') + (g.items || []).map(t => `<div class="ing ro"><span>${fmt(t)}</span></div>`).join('')).join('');
  let n = 0;
  const steps = (d.steps || []).map(sec => (sec.section ? `<div class="stephead">${esc(sec.section)}</div>` : '') + (sec.items || []).map(st => { n++; return `<div class="step ro"><span class="num">${n}</span><span class="tx">${st.title ? `<div class="tt">${esc(st.title)}</div>` : ''}<p>${fmt(st.text)}</p></span></div>`; }).join('')).join('');
  const srcs = (d.links || []).filter(l => /^https?:\/\//i.test(l.url || ''));
  const notes = (d.notes && d.notes.length) || srcs.length ? `<div class="card panel extras">${d.notes && d.notes.length ? `<h4>Good to know</h4><ul>${d.notes.map(x => `<li>${fmt(x)}</li>`).join('')}</ul>` : ''}${srcs.map((l, li) => `<a class="olink" href="${esc(l.url)}" target="_blank" rel="noopener"><span><b>${li === 0 ? 'View original recipe' : esc(l.label || 'View on ' + hostOf(l.url))}</b><small>${esc(hostOf(l.url))}</small></span>${ICON_EXT}</a>`).join('')}</div>` : '';
  return `<button class="back" data-act="go" data-h="f-${esc(fid)}">← ${esc(kitchenOf(f.name))}</button>
  <div class="card hero"><div class="art ${d.photo ? 'photo' : 'drawn'}">${d.photo ? pic(d) : `<div class="artbg">${art(kindOf(d), artText(d))}</div><div class="artfg">${art(kindOf(d), artText(d)).replace('xMidYMid slice', 'xMidYMid meet')}</div>`}</div><div class="body">
    <div class="ttlrow"><h2>${esc(d.title)}</h2></div>
    <div class="byl">${avatar(fid, f.name, 'xs')}From ${esc(kitchenOf(f.name))}</div>
    <div class="meta">${d.yield ? `<span>${ICON_SERV}${esc(d.yield)}</span>` : ''}${d.total ? `<span>${ICON_TIME}${esc(d.total)}</span>` : d.cook ? `<span>${ICON_TIME}${esc(d.cook)}</span>` : ''}</div>
    ${autoTags(d).length ? `<div class="rtags">${autoTags(d).map(t => `<span class="rtag ro">${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="actrow">${saved ? `<button class="btn primary grow" data-act="go" data-h="r-${esc(saved.id)}">${ICON_OK}Saved · Open yours</button>` : `<button class="btn primary grow" data-act="fsave" data-f="${esc(fid)}" data-id="${esc(rid)}" data-open="1">${ICON_PLUS2}Save to my recipes</button>`}</div>
  </div></div>
  <div class="layout">
    <div class="card panel ing-col"><div class="inghead"><h3>Ingredients</h3></div>${ings || '<div class="muted">No ingredients listed.</div>'}</div>
    <div><h3 style="font-size:19px;margin:0 4px 10px">Steps</h3>${steps || '<div class="card empty">No steps listed.</div>'}${notes}</div>
  </div>`;
}
function renderSendSheet(r){
  const acc = (friends || []).filter(f => f.status === 'accepted');
  return `<div class="sheetbg" data-act="sendclose"></div><div class="asksheet frsheet" role="dialog" aria-label="Send to a friend"><div class="askt">Send ${esc(D(r).title)}</div>
    ${acc.length ? `<div class="sendlist">${acc.map(f => `<label class="sendrow">${avatar(f.friend_id, f.name, 'sm')}<span>${esc(f.name)}</span><input type="checkbox" class="sendck" value="${esc(f.friend_id)}" ${acc.length === 1 ? 'checked' : ''}></label>`).join('')}</div>
    <textarea class="tin" id="send-note" data-keep rows="2" maxlength="280" placeholder="Add a note (optional)"></textarea>
    <button class="btn primary bigbtn" data-act="sendgo" data-id="${esc(r.id)}">Send</button>`
    : `<p class="frp">Add a friend first, then you can send them recipes.</p><button class="btn primary bigbtn" data-act="go" data-h="friends">${ICON_ADDF}Add a friend</button>`}</div>`;
}

async function saveCopy(data, from){
  const d = JSON.parse(JSON.stringify(data || {})); d.savedFrom = from;
  const id = crypto.randomUUID();
  if(d.photo){
    try{ const blob = await (await fetch(d.photo)).blob(); const up = await uploadPhoto(id, blob); d.photo = up.url; d.photoPath = up.path; }
    catch(e){ delete d.photo; delete d.photoPath; }
  } else delete d.photoPath;
  const {data: row, error} = await sb.from('recipes').insert({id, user_id: user.id, sort: Date.now(), data: d}).select('id, sort, data').single();
  if(error) throw error;
  recipes.push(row); return row;
}
async function copyInviteLink(){
  const {data, error} = await sb.rpc('create_invite_link');
  if(error || !data){ toast("Couldn't make a link. Try again."); return; }
  const url = location.origin + location.pathname + '#invite-' + data;
  const text = `${firstName() || 'I'} invited you to share recipes on Mixing Bowl`;
  if(navigator.share && matchMedia('(pointer: coarse)').matches){ try{ await navigator.share({title: 'Mixing Bowl', text, url}); return; }catch(e){ if(e && e.name === 'AbortError') return; } }
  try{ await navigator.clipboard.writeText(url); toast('Invite link copied'); }catch(e){ prompt('Copy this invite link', url); }
}
// invite links: remember the token through sign-up / email confirmation
function inviteToken(){ try{ return localStorage.getItem('mb_invite'); }catch(e){ return null; } }
function rememberInvite(t){ try{ localStorage.setItem('mb_invite', t); }catch(e){} if(!inviteInfo || inviteInfo.t !== t){ inviteInfo = {t, name: null}; sb.rpc('invite_link_info', {t}).then(({data}) => { inviteInfo = {t, name: data || null, bad: !data}; render(); }); } }
function forgetInvite(){ try{ localStorage.removeItem('mb_invite'); }catch(e){} }
function renderInviteCard(){
  if(!inviteInfo || inviteInfo.bad) return '';
  if(inviteInfo.name === '__self'){ setTimeout(() => { forgetInvite(); inviteInfo = null; toast("That's your own invite link. Share it with a friend."); render(); }); return ''; }
  return `<div class="modal"><div class="card mcard" data-stop>${avatar(inviteInfo.t, inviteInfo.name || '?', 'big')}<h3>${esc(inviteInfo.name || 'Someone')} wants to be friends</h3><p>You'll be able to see each other's recipes and save copies.</p>
    <button class="btn primary bigbtn" data-act="invaccept">Accept</button><button class="btn outline bigbtn" data-act="invno">Decline</button></div></div>`;
}

let lastView = '';
function render(){
  const kept = {}; document.querySelectorAll('[data-keep]').forEach(el => { if(el.id) kept[el.id] = el.type === 'checkbox' ? el.checked : el.value; });
  const icol = document.querySelector('.ing-col'), icolTop = icol ? icol.scrollTop : 0;
  const ae = document.activeElement && document.activeElement.id && document.activeElement.hasAttribute('data-keep') ? document.activeElement : null;
  let sel = null; try{ sel = ae && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null; }catch(e){}
  let r = route();
  if(r.v === 'invite' && sb){ rememberInvite(r.id); if(!user && authView.mode === 'signin' && !authView.invSet){ authView = {mode:'signup', msg:'', err:'', busy:false, invSet:true}; } if(user){ history.replaceState(null, '', '#friends'); r = route(); } }
  if(!(user && !recovering && gate !== 'in')) delete app.dataset.gate;
  $('#hdr').innerHTML = renderHeader(r);
  if(!sb){ return; }
  if(!user && r.v === 'privacy'){ app.innerHTML = renderPrivacy(); $('#tabs').innerHTML = ''; }
  else if(!user && r.v === 'terms'){ app.innerHTML = renderTerms(); $('#tabs').innerHTML = ''; }
  else if(!user && r.v === 'feedback'){ app.innerHTML = renderFeedback(); $('#tabs').innerHTML = ''; }
  else if(!user || recovering){ app.innerHTML = renderAuth(); $('#tabs').innerHTML = ''; }
  else if(gate !== 'in'){ const g = renderGate(); if(app.dataset.gate !== g){ app.innerHTML = g; app.dataset.gate = g; } $('#tabs').innerHTML = ''; }
  else if(!loaded){ app.innerHTML = `<div class="grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`; }
  else {
    renderTabs(r);
    if(r.v === 'shopping') app.innerHTML = renderShopping();
    else if(r.v === 'recipes') app.innerHTML = renderRecipes();
    else if(r.v === 'friends') app.innerHTML = renderFriends() + (inviteToken() ? renderInviteCard() : '');
    else if(r.v === 'fbook') app.innerHTML = renderFbook(r.id);
    else if(r.v === 'frecipe') app.innerHTML = renderFrecipe(r.id);
    else if(r.v === 'form') app.innerHTML = renderForm(r.id);
    else if(r.v === 'account') app.innerHTML = renderAccount();
    else if(r.v === 'settings') app.innerHTML = renderSettings();
    else if(r.v === 'privacy') app.innerHTML = renderPrivacy();
    else if(r.v === 'terms') app.innerHTML = renderTerms();
    else if(r.v === 'feedback') app.innerHTML = renderFeedback();
    else if(r.v === 'help') app.innerHTML = renderHelp();
    else if(r.v === 'trips') app.innerHTML = renderTrips();
    else if(r.v === 'admin') app.innerHTML = renderAdmin();
    else app.innerHTML = renderRecipe(r.id);
    maybeTour();
  }
  const sameView = (r.v + (r.id || '')) === lastView;
  if(sameView && icolTop){ const ic = document.querySelector('.ing-col'); if(ic) ic.scrollTop = icolTop; }
  setTimeout(() => { stepPreview(); onNavScroll(); }, 0);
  if(sameView) document.querySelectorAll('[data-keep]').forEach(el => { if(el.id && kept[el.id] != null && el.type !== 'file'){ if(el.type === 'checkbox') el.checked = kept[el.id]; else el.value = kept[el.id]; } });
  { const fp = $('#f-paste'), fb = $('#f-parsebtn'); if(fp && fb) fb.disabled = !fp.value.trim(); }
  if(ae && sameView){ const el = document.getElementById(ae.id); if(el){ el.focus({preventScroll:true}); if(sel && el.setSelectionRange) try{ el.setSelectionRange(sel[0], sel[1]); }catch(e){} } }
  const key = r.v + (r.id || '');
  if(key !== lastView){ window.scrollTo(0, 0); lastView = key; }
  renderFab(r);
}
function renderHeader(r){
  const n = firstName();
  const kn = user && n && !recovering ? `<span class="kname">${esc(n)}'s Kitchen</span>` : '';
  return `<div class="bwrap"><h1>Mixing <span>Bowl</span></h1>${kn}</div><div class="hright">${user && !recovering ? `<div id="status" class="status ${statusNow.kind}"><i class="dot"></i><span>${esc(statusNow.text)}</span></div><button class="avatar" data-act="menu" aria-label="Your menu" aria-expanded="${menuOpen}">${esc((n || (user.email || '?'))[0].toUpperCase())}</button>${menuOpen ? renderMenu() : ''}` : ''}</div>`;
}
function renderTabs(r){
  const left = visibleItems().filter(it => !P().shop[it.id]).length;
  $('#tabs').innerHTML = `<button class="tab ${r.v === 'shopping' ? 'on' : ''}" data-act="go" data-h="shopping">Shopping list${left ? `<span class="n">(${left})</span>` : ''}</button>
  <button class="tab ${!['shopping','account','friends','fbook','frecipe'].includes(r.v) ? 'on' : ''}" data-act="go" data-h="recipes">Recipes${recipes.filter(r => !isArch(r.id)).length ? `<span class="n">(${recipes.filter(r => !isArch(r.id)).length})</span>` : ''}</button>
  <button class="tab ${['friends','fbook','frecipe'].includes(r.v) ? 'on' : ''}" data-act="go" data-h="friends">Friends${friendsNew() ? '<span class="rdot" aria-label="New"></span>' : ''}</button>`;
}

function renderShopping(){
  const items = visibleItems(), all = allItems(), shop = P().shop, f = ui.filter;
  const done = items.filter(it => shop[it.id]).length;
  const pct = items.length ? Math.round(done / items.length * 100) : 0;
  const chipRecipes = recipes.filter(r => !(P().done || {})[r.id] && !isArch(r.id));
  const chips = chipRecipes.map(r => `<button class="chip ${isActive(r.id) ? 'on' : ''}" style="--c:${esc(D(r).color || '#888')}" data-act="active" data-drag="1" data-id="${esc(r.id)}"><i class="sw"></i>${esc(D(r).short || D(r).title)}</button>`).join(' ');
  const Q = shopQ.trim().toLowerCase();
  const pool = Q ? all.filter(i => i.name.toLowerCase().includes(Q) && (items.includes(i) || shop[i.id])) : f === 'have' ? all : items;
  const keep = i => { const st = shop[i.id] || ''; return Q || f === 'all' || (f === 'need' && !st) || (f === 'cart' && st === 'bought') || (f === 'have' && st === 'have'); };
  const cnt = {all: items.length, need: items.filter(i => !shop[i.id]).length, cart: items.filter(i => shop[i.id] === 'bought').length, have: all.filter(i => shop[i.id] === 'have').length};
  const fbtn = (k, l) => `<button class="${f === k ? 'on' : ''}" aria-pressed="${f === k}" data-act="filter" data-f="${k}">${l} <span class="fc">${cnt[k]}</span></button>`;
  const order = [...new Set(kitchen.shopping.sections.concat(all.map(i => i.section || 'Other')))];
  let secs = '';
  order.forEach(sec => {
    let list = pool.filter(i => (i.section || 'Other') === sec); if(!list.length) return;
    const left = list.filter(i => !shop[i.id]).length;
    list = list.slice().sort((a, b) => (shop[a.id] ? 1 : 0) - (shop[b.id] ? 1 : 0)).filter(keep);
    if((Q || f !== 'all') && !list.length) return;
    const sub = Q ? list.length + (list.length === 1 ? ' match' : ' matches') : f === 'have' ? list.length + ' on hand' : f === 'cart' ? list.length + ' in cart' : (left ? left + ' to get' : 'all set ✓');
    secs += `<div class="section" data-sec="${esc(sec)}"><h3>${esc(sec)} <small>${sub}</small><span class="secmv"><button class="up" data-act="secmv" data-s="${esc(sec)}" data-d="-1" aria-label="Move ${esc(sec)} up"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button><button class="dn" data-act="secmv" data-s="${esc(sec)}" data-d="1" aria-label="Move ${esc(sec)} down"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button></span></h3><div class="card items">` + list.map(it => {
      const st = shop[it.id] || '';
      const tags = (it.custom ? `<span class="tag" style="--c:#6E6259">Added by you</span>` : '') + (it.recipes || []).map(x => { const rr = R(x); return rr ? `<span class="tag" style="--c:${esc(D(rr).color)}">${esc(D(rr).short || D(rr).title)}</span>` : ''; }).join('');
      return `<div class="item ${st}"><button class="check" data-act="bought" data-id="${esc(it.id)}" aria-label="In my cart">${CHECK}</button>
      <div class="info"><div class="name">${Q ? esc(it.name).replace(new RegExp('(' + esc(Q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'i'), '<mark>$1</mark>') : esc(it.name)}</div>${it.qty ? `<div class="qty">${fmt(it.qty)}</div>` : ''}<div class="tags">${tags}</div></div>
      <button class="have" data-act="have" data-id="${esc(it.id)}">${st === 'have' ? 'Have it ✓' : 'Have it'}</button><button class="del" data-act="delitem" data-id="${esc(it.id)}" aria-label="Remove ${esc(it.name)}">✕</button></div>`;
    }).join('') + `</div></div>`;
  });
  const secOpts = kitchen.shopping.sections;
  return `<div class="card shop-head"><button class="copyic" data-act="copy" aria-label="Copy my list" title="Copy what I still need"><svg class="bi" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2"/></svg></button>
    ${chipRecipes.length ? `<div class="lbl">Shopping for</div><div class="row">${chips}</div><div class="draghint">Done with a recipe? Drag it to Past trips.</div>` : ''}
    <div class="prog-line"><b>${done} of ${items.length} sorted</b><span class="muted">${items.length - done} still remaining</span></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
  </div>
  ${all.length ? `<div class="shopsearch ${Q ? 'on' : ''}" role="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input id="shopq" data-keep type="search" enterkeyhint="search" autocomplete="off" placeholder="Search your list" value="${esc(shopQ)}" aria-label="Search your list">${Q ? '<button class="sclear" data-act="sclear" aria-label="Clear search">✕</button>' : ''}</div>` : ''}
  ${Q ? `<div class="qnote" aria-live="polite">${pool.length ? `${pool.length} match${pool.length === 1 ? '' : 'es'} across Need, In cart and Have` : `Nothing on your list matches “${esc(shopQ.trim())}”`}</div>` : ''}
  ${!Q && (all.length || (P().trips || []).length) ? `<div class="seg" role="group" aria-label="Show">${fbtn('all','All')}${fbtn('need','Need')}${fbtn('cart','In cart')}${fbtn('have','Have')}</div>` : ''}
  ${Q ? '' : ui.addOpen ? `<form class="card addcard addf" data-form="additem" autocomplete="off">
      <input id="addName" data-keep placeholder="Item (e.g. blueberries)" maxlength="80" required>
      <input id="addQty" data-keep placeholder="Amount" aria-label="Amount (optional)" maxlength="60">
      <select id="addSec" data-keep aria-label="Section">${secOpts.map(s => `<option ${s === ui.sec ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select id="addFor" data-keep aria-label="Which recipe is it for?"><option value="">No recipe</option>${recipes.map(r => `<option value="${esc(r.id)}">For ${esc(D(r).short || D(r).title)}</option>`).join('')}</select>
      <button class="btn primary" type="submit">+ Add</button>
      <button class="btn" type="button" data-act="addclose">Done</button>
    </form>` : `<button class="addrow" data-act="addopen"><span>+</span> Add an item</button>`}
  <div class="f-${f}">${secs || (Q ? '' : `<div class="card empty">${!all.length ? 'Nothing here yet. Open a recipe and tap <b>Add to shopping list</b>, or add an item above.' : f === 'have' ? 'Nothing marked “Have it” yet.' : f === 'cart' ? 'Nothing in your cart yet.' : "All set — time to cook! 🎉"}</div>`)}</div>
  ${all.length || (P().trips || []).length ? `${all.length && !Q ? `<div class="tripfoot2"><div class="tf2-ic" aria-hidden="true"><svg class="bi" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 10.5a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2L20 8H6.2"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/></svg></div><div class="tf2-t"><span><b>${cnt.cart}</b> in your cart</span><span><b>${cnt.need}</b> still needed</span></div><button class="btn primary" data-act="resetshop">Finish trip</button></div>` : ''}<div class="tf2-links"><button class="tf-link" data-act="go" data-h="trips">Past trips (${(P().trips || []).length})</button></div>` : ''}
  ${chipRecipes.length ? `<div id="tripDrop" class="dropzone" aria-hidden="true"><svg class="bi" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 7v5l3 2"/></svg>Drop here to move to Past trips</div>` : ''}`;
}

/* ---- tags, favorites, sorting (stored per person in kitchen.progress) ---- */
const TAGS0 = ['Appetizers','Dips','Breakfast','Mains','Sides','Soups','Salads','Pasta','Pizza','Breads','Desserts','Beverages','Vegetarian','Chicken','Beef','Pork'];
const TAGRX = [['Desserts',/\b(pie|cakes?|cookies?|brownies?|frosting|tarts?|pudding|cheesecake|cupcakes?|fudge|crisp|cobbler|ice cream|cake pops?|truffles?|bars)\b/],['Pizza',/pizza/],['Pasta',/pasta|lasagna|spaghetti|noodle|mac and|penne|ravioli|linguine|fettuccine/],['Soups',/soup|stew|chili|chowder|bisque/],['Salads',/salad/],['Breads',/bread|rolls?\b|biscuit|focaccia|bagel/],['Breakfast',/pancake|waffle|oatmeal|granola|muffin|frittata|omelet|french toast/],['Appetizers',/bites|crostini|wings|appetizer|sliders/],['Dips',/\bdip\b|salsa|hummus|guac/],['Beverages',/drink|cocktail|smoothie|lemonade|latte|punch|cider/],['Sides',/casserole|roasted|mashed|slaw|stuffing/],['Chicken',/chicken/],['Beef',/beef|steak|brisket|meatball/],['Pork',/pork|bacon|\bham\b|sausage|carnitas/]];
const MEAT = /chicken|beef|pork|bacon|sausage|\bham\b|turkey|fish|shrimp|salmon|tuna|steak|brisket|prosciutto|pepperoni|anchov|gelatin/;
function autoTags(d){
  const t = (d.title || '').toLowerCase(), ing = (d.ingredients || []).flatMap(g => g.items || []).join(' ').toLowerCase();
  let out = TAGRX.filter(([, rx]) => rx.test(t)).map(([k]) => k);
  if(out.includes('Sides') && out.some(x => ['Pasta','Pizza','Soups','Desserts','Salads','Breakfast'].includes(x))) out = out.filter(x => x !== 'Sides');
  ['Chicken','Beef','Pork'].forEach((k, i) => { if(!out.includes(k) && [/chicken/, /beef|steak|brisket/, /pork|bacon|\bham\b|sausage/][i].test(ing) && !out.includes('Desserts')) out.push(k); });
  if(!MEAT.test(ing + ' ' + t)) out.push('Vegetarian');
  else if(!out.includes('Desserts') && !out.some(x => ['Soups','Salads','Pizza','Pasta','Appetizers','Sides','Breakfast'].includes(x))) out.push('Mains');
  return [...new Set(out)];
}
const tagsOf = r => ((P().tags || {})[r.id]) || autoTags(D(r));
const favOf = id => !!((P().fav || {})[id]);
const allTags = () => { const used = recipes.flatMap(r => tagsOf(r)); return [...new Set(TAGS0.concat(P().ctags || [], used))]; };
let recTags = [], recFav = false, recQ = '', catOpen = false, sortOpen = false, tagEdit = null;
const SORTS = {recent:'Recent', az:'A–Z', made:'Most made', progress:'In progress'};
const ICON_SERV = '<svg class="mi" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v7M5 3v5a2 2 0 0 0 4 0V3M7 10v11M17 21V3c-2 1.5-3 4-3 7v3h3"/></svg>';
const ICON_TIME = '<svg class="mi" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
const ICON_AGAIN = '<svg class="bi" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/></svg>';
const ICON_EXT = '<svg class="ext" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
function finCard(r){ return `<button class="btn primary again" data-act="again" data-id="${esc(r.id)}">${ICON_AGAIN}Make it again</button>`; }
const ICON_HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';
const ICON_SORT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/></svg>';
const ICON_CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
function renderRecipes(){
  const addTile = `<button class="tile addtile" data-act="go" data-h="add"><span class="plus">+</span><span class="body"><h2>Add a recipe</h2><span class="meta">From a link or paste</span></span></button>`;
  const starters = !recipes.length ? `<div class="card panel" style="margin-bottom:16px"><h3>Start with a favorite?</h3><p class="muted" style="margin:4px 0 12px">Add our Blueberry Pie to try things out. Remove it anytime.</p><button class="btn primary" data-act="starters">Add Blueberry Pie</button></div>` : '';
  const live = recipes.filter(r => !isArch(r.id)), arch = recipes.filter(r => isArch(r.id));
  const search = recipes.length > 1 ? `<div class="rsearch"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input id="rsearch" type="search" placeholder="Search recipes" aria-label="Search recipes" autocomplete="off" value="${esc(recQ)}"></div>` : '';
  const archBox = arch.length ? `<details class="card archbox" id="archbox"><summary>Archived <span class="fc">${arch.length}</span><span class="chev">▾</span></summary>${arch.map(r => `<div class="arow" data-q="${esc((D(r).title + ' ' + (D(r).short || '')).toLowerCase())}"><button class="aname" data-act="go" data-h="r-${esc(r.id)}"><i class="sw" style="--c:${esc(D(r).color || '#888')}"></i>${esc(D(r).title)}</button><button class="btn" data-act="unarch" data-id="${esc(r.id)}">Unarchive</button></div>`).join('')}</details>` : '';
  const sortK = SORTS[ui.rsort] ? ui.rsort : 'recent';
  const counts = {}; live.forEach(r => tagsOf(r).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
  const cats = allTags().filter(t => counts[t]).sort((x, y) => x.localeCompare(y));
  recTags = recTags.filter(t => counts[t]);
  const nFav = live.filter(r => favOf(r.id)).length; if(!nFav) recFav = false;
  const catOn = recTags.length > 0;
  const hasAll = (r, list) => { const tg = tagsOf(r); return list.every(t => tg.includes(t)); };
  const catLabel = recTags.length > 2 ? `${esc(recTags[0])} + ${recTags.length - 1} more` : recTags.map(esc).join(' + ');
  const fbar = live.length > 1 ? `<div class="fbar2"><div class="fwrap"><button class="fpill ${catOn ? 'act' : ''}" data-act="catmenu" aria-haspopup="true" aria-expanded="${catOpen}">Category${catOn ? `<span class="fcount">${recTags.length}</span>` : ''}${ICON_CHEV}</button>
    ${catOpen ? `<div class="fmenu" role="group" aria-label="Categories"><button class="fall ${!catOn ? 'on' : ''}" data-act="catclear">All categories <span>${live.length}</span></button>${cats.map(t => { const on = recTags.includes(t); const n = on ? live.filter(r => hasAll(r, recTags)).length : live.filter(r => hasAll(r, recTags.concat(t))).length; return `<button class="fck ${on ? 'on' : ''} ${!on && !n ? 'dim' : ''}" data-act="catpick" data-t="${esc(t)}" role="checkbox" aria-checked="${on}"><i class="cb">${on ? CHECK : ''}</i><b>${esc(t)}</b><span>${on ? '' : n}</span></button>`; }).join('')}</div>` : ''}</div>
    ${nFav ? `<button class="fpill favp ${recFav ? 'on' : ''}" data-act="favfilter" aria-pressed="${recFav}">${ICON_HEART}Favorites</button>` : ''}
    <div class="fwrap fright"><button class="fpill sortp" data-act="sortmenu" aria-haspopup="menu" aria-expanded="${sortOpen}" aria-label="Sort: ${SORTS[sortK]}">${ICON_SORT}${SORTS[sortK]}</button>
    ${sortOpen ? `<div class="fmenu right" role="menu">${Object.entries(SORTS).map(([k, l]) => `<button role="menuitem" class="${k === sortK ? 'on' : ''}" data-act="sortpick" data-k="${k}">${l}${k === sortK ? '<span>✓</span>' : ''}</button>`).join('')}</div>` : ''}</div></div>` : '';
  const rank = r => { const p = progressOf(r); return p.done > 0 && p.done < p.total ? 0 : p.done === 0 ? 1 : 2; };
  let shown = live.filter(r => (!catOn || hasAll(r, recTags)) && (!recFav || favOf(r.id)) && (sortK !== 'progress' || rank(r) === 0));
  const pos = new Map(live.map((r, i) => [r.id, i]));
  shown = shown.slice().sort((a, b) => (favOf(b.id) - favOf(a.id)) || (sortK === 'az' ? D(a).title.localeCompare(D(b).title) : sortK === 'made' ? (madeOf(b.id).n || 0) - (madeOf(a.id).n || 0) : sortK === 'progress' ? rank(a) - rank(b) : 0) || pos.get(a.id) - pos.get(b.id));
  const q = recQ.trim().toLowerCase();
  const filtered = catOn || recFav || sortK === 'progress';
  const fnote = catOn ? `<div class="selchips">${recTags.map(t => `<span class="selchip">${esc(t)}<button data-act="catpick" data-t="${esc(t)}" aria-label="Remove ${esc(t)} filter">✕</button></span>`).join('')}${recTags.length > 1 ? `<button class="clearall" data-act="catclear">Clear all</button>` : ''}</div>${recTags.length > 1 ? `<div class="fnote">Showing recipes with ${recTags.length === 2 ? 'both' : 'all ' + recTags.length} tags</div>` : ''}` : '';
  return starters + search + fbar + fnote + `<div class="grid" id="rgrid">` + (filtered ? '' : q ? addTile.replace('<button class="tile addtile"', '<button hidden class="tile addtile"') : addTile) + shown.map(r => {
    const d = D(r), p = progressOf(r), pct = p.total ? Math.round(p.done / p.total * 100) : 0;
    const st = p.done === 0 ? 'Not started' : p.done === p.total ? 'Finished ✓' : `Step ${p.cur + 1} of ${p.total}`;
    const tq = (d.title + ' ' + (d.short || '') + ' ' + tagsOf(r).join(' ')).toLowerCase(), tt = tagsOf(r).slice(0, 3);
    return `<div class="tile" ${q && !tq.includes(q) ? 'hidden' : ''} role="link" tabindex="0" style="--c:${esc(d.color)}" data-act="go" data-h="r-${esc(r.id)}" data-q="${esc(tq)}">
      <span class="art">${pic(d)}</span><button class="tilefav ${favOf(r.id) ? 'on' : ''}" data-act="fav" data-id="${esc(r.id)}" aria-pressed="${favOf(r.id)}" aria-label="${favOf(r.id) ? 'Remove from favorites' : 'Add to favorites'}" title="${favOf(r.id) ? 'Favorite' : 'Add to favorites'}">${ICON_HEART}</button><button class="tilex" data-act="recipex" data-id="${esc(r.id)}" aria-label="Archive or delete ${esc(d.title)}" title="Archive or delete"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <span class="body">${tt.length ? `<span class="ttags">${tt.map(t => `<i>${esc(t)}</i>`).join('')}</span>` : ''}<h2>${esc(d.title)}</h2><span class="meta">${d.yield ? `<span>${ICON_SERV}${esc(d.yield)}</span>` : ''}${d.total ? `<span>${ICON_TIME}${esc(d.total)}</span>` : ''}</span>
      ${isPriv(r.id) ? `<span class="privtag sm">${ICON_LOCK}Private</span>` : ''}<span class="st ${p.done === 0 ? 'new' : p.done === p.total ? 'done' : 'prog'}">${st}</span><span class="bar"><i style="width:${pct}%"></i></span></span></div>`;
  }).join('') + `</div><div class="card empty" id="rnone" ${filtered && !shown.length ? '' : 'hidden'}>${sortK === 'progress' && !shown.length && !catOn && !recFav ? 'Nothing in progress right now. Open a recipe and check off a step to start.' : recTags.length > 1 ? `No recipes have ${recTags.length === 2 ? 'both' : 'all'} of these tags. Remove one to see more.` : 'No recipes match.'}</div>` + archBox;
}

function renderRecipe(id){
  const r = R(id);
  if(!r) return `<button class="back" data-act="go" data-h="recipes">← All recipes</button><div class="card empty">That recipe isn't here anymore.</div>`;
  const d = D(r), c = cookOf(r.id), p = progressOf(r), pct = p.total ? Math.round(p.done / p.total * 100) : 0;
  const ings = (d.ingredients || []).map((g, gi) => (g.group ? `<div class="grp">${esc(g.group)}</div>` : '') + (g.items || []).map((t, k) => { const key = gi + '-' + k; const row = `<button class="ing ${c.i[key] ? 'on' : ''}" data-act="ing" data-id="${esc(r.id)}" data-k="${key}"><i class="box">${CHECK}</i><span>${fmt(t)}</span></button>`;
    if(choosing !== r.id || !splitIngredient(t).key) return row;
    const inl = ingListed(r.id, t);
    return `<div class="ingrow">${row}<button class="ingadd ${inl ? 'in' : ''}" data-act="ingadd" data-id="${esc(r.id)}" data-k="${key}" aria-label="${inl ? 'Remove from shopping list' : 'Add to shopping list'}" title="${inl ? 'On your list. Tap to remove' : 'Add to shopping list'}">${inl ? CHECK.replace('#fff', 'currentColor') : ICON_PLUS}</button></div>`; }).join('')).join('');
  let n = 0; const curKey = p.cur >= 0 && p.all[p.cur] ? p.all[p.cur].key : null;
  const steps = (d.steps || []).map((sec, si) => (sec.section ? `<div class="stephead">${esc(sec.section)}</div>` : '') + (sec.items || []).map((st, k) => {
    const key = si + '-' + k; n++; const done = !!c.s[key]; const cur = !done && key === curKey;
    const tm = (st.timers || []).map(t => `<span class="tchip" data-act="timer" data-min="${+t.min}" data-label="${esc(t.label)}">⏲ ${esc(t.label)}</span>`).join('');
    return `<button class="step ${done ? 'done' : ''} ${cur ? 'cur' : ''}" id="s-${key}" data-act="step" data-id="${esc(r.id)}" data-k="${key}"><span class="num">${done ? '✓' : n}</span><span class="tx">${st.title ? `<div class="tt">${esc(st.title)}</div>` : ''}<p>${fmt(st.text)}</p>${tm ? `<div class="tchips">${tm}</div>` : ''}</span></button>`;
  }).join('')).join('');
  const srcs = (d.links || []).filter(l => /^https?:\/\//i.test(l.url || ''));
  const hasNotes = d.notes && d.notes.length;
  const notes = hasNotes || srcs.length ? `<div class="card panel extras">${hasNotes ? `<h4>Good to know</h4><ul>${d.notes.map(x => `<li>${fmt(x)}</li>`).join('')}</ul>` : ''}${srcs.map((l, li) => `<a class="olink" href="${esc(l.url)}" target="_blank" rel="noopener"><span><b>${li === 0 ? 'View original recipe' : esc(l.label && l.label !== 'Original recipe' ? l.label : 'View on ' + hostOf(l.url))}</b><small>${esc(hostOf(l.url))}</small></span>${ICON_EXT}</a>`).join('')}</div>` : '';
  return `<button class="back" data-act="go" data-h="recipes">← All recipes</button>
  <div class="card hero"><div class="art ${d.photo ? 'photo' : 'drawn'}">${d.photo ? pic(d) : `<div class="artbg">${art(kindOf(d), artText(d))}</div><div class="artfg">${art(kindOf(d), artText(d)).replace('xMidYMid slice', 'xMidYMid meet')}</div>`}<label class="heroedit" title="Change image" aria-label="Change image">${photoBusy === r.id ? '<span class="spin dark"></span>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>'}<input type="file" accept="image/*" hidden data-photo-for="${esc(r.id)}"></label></div><div class="body">
    <div class="ttlrow"><h2>${esc(d.title)}</h2><div class="ttlbtns"><button class="ibtn editpill" data-act="go" data-h="edit-${esc(r.id)}" title="Edit recipe">${ICON_PEN}<span>Edit</span></button><button class="ibtn ${moreOpen ? 'on' : ''}" data-act="more" aria-label="More options" aria-expanded="${moreOpen}">${ICON_MORE}</button>${moreOpen ? `<div class="moremenu" role="menu"><button role="menuitemcheckbox" aria-checked="${isPriv(r.id)}" class="privrow" data-act="privtog" data-id="${esc(r.id)}">${ICON_LOCK.replace('class="bi"', '')}<span class="pl"><b>Private</b><small>${isPriv(r.id) ? 'Only you can see this recipe' : 'Friends can see this recipe'}</small></span><span class="tog ${isPriv(r.id) ? 'on' : ''}"><i></i></span></button><button role="menuitem" data-act="sendopen" data-id="${esc(r.id)}">${ICON_SEND}Send to a friend</button><button role="menuitem" data-act="resetrecipe" data-id="${esc(r.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4h4"/></svg>Reset progress</button>${isArch(r.id) ? `<button role="menuitem" data-act="unarch" data-id="${esc(r.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10h14V9M10 13h4"/></svg>Unarchive</button>` : `<button role="menuitem" data-act="archive" data-id="${esc(r.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10h14V9M10 13h4"/></svg>Archive</button>`}<button role="menuitem" class="danger" data-act="delrecipe" data-id="${esc(r.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>Delete recipe</button></div>` : ''}</div></div>
    ${d.savedFrom ? `<div class="byl">${avatar(d.savedFrom.owner || d.savedFrom.name, d.savedFrom.name, 'xs')}Saved from ${esc(kitchenOf(d.savedFrom.name))}</div>` : ''}${isPriv(r.id) ? `<div class="privtag">${ICON_LOCK}Private · only you can see this</div>` : ''}
    <div class="meta">${d.yield ? `<span>${ICON_SERV}${esc(d.yield)}</span>` : ''}${d.total ? `<span>${ICON_TIME}${esc(d.total)}</span>` : d.cook ? `<span>${ICON_TIME}${esc(d.cook)}</span>` : ''}${madeOf(r.id).n ? `<span class="made">♥ Made ${madeOf(r.id).n}×</span>` : ''}</div>
    <div class="rtags">${tagsOf(r).map(t => `<span class="rtag">${esc(t)}<button class="rtx" data-act="tagtog" data-id="${esc(r.id)}" data-t="${esc(t)}" aria-label="Remove ${esc(t)} tag" title="Remove tag">✕</button></span>`).join('')}<button class="rtag add" data-act="tagedit" data-id="${esc(r.id)}">${tagsOf(r).length ? '+ Tag' : '+ Add a tag'}</button></div>
    <div class="prog-line" style="margin-top:14px"><b>${p.total && p.done === p.total ? 'All done — enjoy!' : `${p.done} of ${p.total} steps`}</b>${p.total && p.done < p.total ? `<button class="mc" data-act="markall" data-id="${esc(r.id)}">Mark complete</button>` : (P().cook[r.id] || {}).before ? `<button class="mc undo" data-act="unmark" data-id="${esc(r.id)}" title="Go back to where you were"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>Undo</button>` : `<span class="muted">${pct}%</span>`}</div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="actrow">${isArch(r.id) ? `<button class="btn primary grow" data-act="unarch" data-id="${esc(r.id)}">Unarchive</button>` : `<button class="btn primary addlist grow" data-act="addask" data-id="${esc(r.id)}"><svg class="bi" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 10.5a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2L20 8H6.2"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/></svg>Add to shopping list</button>`}<button class="btn wake ${wakeLock ? 'on' : ''}" data-act="wake" aria-pressed="${!!wakeLock}" title="Keep the screen from turning off while you cook"><svg class="bi" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>Screen on</button></div>
  </div></div>
  <div class="layout">
    <div class="card panel ing-col"><div class="inghead"><h3>Ingredients</h3>${choosing === r.id ? `<button class="linkbtn addall" data-act="choosedone">Done</button>` : ''}</div>${ings || '<div class="muted">No ingredients yet.</div>'}</div>
    <div><h3 style="font-size:19px;margin:0 4px 10px">Steps</h3>${steps || '<div class="card empty">No steps yet.</div>'}
    ${notes}${p.total && p.done === p.total ? finCard(r) : ''}
</div>
  </div>
  ${addSheet && addSheet.id === r.id ? `<div class="sheetbg" data-act="sheetclose"></div><div class="asksheet" role="dialog" aria-label="Add to your shopping list"><div class="askt">${addSheet.again ? 'Add ingredients to your list?' : 'Add to your shopping list'}</div><button class="askopt main" data-act="addall" data-id="${esc(r.id)}"><b>Add all ${ingLines(d).length} ingredients</b><span>Everything starts unchecked</span></button><button class="askopt" data-act="choose" data-id="${esc(r.id)}"><b>Choose ingredients</b><span>Tap + next to the ones you need</span></button><button class="linkbtn askcancel" data-act="sheetclose">${addSheet.again ? 'Not now' : 'Cancel'}</button></div>` : ''}
  ${tagEdit === r.id ? `<div class="sheetbg" data-act="tagdone"></div><div class="asksheet tagsheet" role="dialog" aria-label="Tags for ${esc(d.title)}"><div class="askt">Tags</div><div class="tagpick">${allTags().map(t => { const on = tagsOf(r).includes(t); const own = (P().ctags || []).includes(t); return `<span class="tpw"><button class="tp ${on ? 'on' : ''} ${own ? 'own' : ''}" data-act="tagtog" data-id="${esc(r.id)}" data-t="${esc(t)}" aria-pressed="${on}">${on ? '✓ ' : ''}${esc(t)}</button>${own ? `<button class="tpdel" data-act="tagdel" data-t="${esc(t)}" aria-label="Delete the ${esc(t)} tag everywhere" title="Delete this tag">✕</button>` : ''}</span>`; }).join('')}</div><form class="newtag" data-form="newtag" data-id="${esc(r.id)}" autocomplete="off"><input id="newtag" data-keep placeholder="New tag, e.g. Holiday" maxlength="24" aria-label="New tag"><button class="btn" type="submit">Add</button></form><button class="btn primary tagdone" data-act="tagdone">Done</button></div>` : ''}
  ${sendSheet === r.id ? renderSendSheet(r) : ''}
  ${choosing === r.id ? `<div class="selbar"><span>${chosenN ? `${chosenN} added to your list` : 'Tap + to add'}</span><button class="btn primary" data-act="choosedone">Done</button></div>` : ''}`;
}
function renderFab(r){
  const old = $('#fab'); if(old) old.remove();
  if(r.v !== 'recipe' || choosing) return; const rr = R(r.id); if(!rr) return; const p = progressOf(rr); if(p.cur < 0 || p.done === 0) return;
  const b = document.createElement('button'); b.id = 'fab'; b.className = 'btn primary fab'; b.textContent = '↓ Current step'; b.dataset.act = 'jump'; b.dataset.k = p.all[p.cur].key; document.body.appendChild(b);
}

/* ---------------- add / edit form ---------------- */
let form = null; // {forId, photoBlob, photoUrl, removePhoto, busy, err}
function ensureForm(id){
  if(!form || form.forId !== (id || 'new')){
    if(form && form.photoUrl) URL.revokeObjectURL(form.photoUrl);
    form = {forId: id || 'new', review: null, photoBlob: null, photoUrl: null, removePhoto: false, busy: false, err: '', filled: false, importing: false, importMsg: '', importOk: false};
  }
  return form;
}
function renderForm(id){
  const r = id ? R(id) : null;
  if(id && !r) return `<button class="back" data-act="go" data-h="recipes">← All recipes</button><div class="card empty">That recipe isn't here anymore.</div>`;
  const f = ensureForm(id), d = r ? D(r) : {};
  const link = (d.links || []).find(l => l.url) || {};
  const v = (k, dv) => esc(dv == null ? '' : dv);
  const photoNow = f.photoUrl || (!f.removePhoto && d.photo) || null;
  return `<button class="back" data-act="go" data-h="${r ? 'r-' + esc(r.id) : 'recipes'}">← ${r ? 'Back to recipe' : 'All recipes'}</button>
  <div class="card panel form">
    <h3>${r ? 'Edit recipe' : 'Add a recipe'}</h3>
    <div class="lbl2">Recipe website link <span class="hint">recommended</span></div>
    <div class="linkrow"><input class="tin" id="f-link" data-keep type="url" inputmode="url" placeholder="Paste a recipe link" value="${v('link', link.url)}"></div>
    ${!r && f.importing ? `<div class="importmsg">Importing…</div>` : !r && f.review ? reviewCard(f.review) : !r && f.importMsg ? `<div class="importmsg ${f.importOk ? 'ok' : ''}">${esc(f.importMsg)}</div>` : ''}
    <div class="lbl2">Recipe title <span class="hint">required</span></div>
    <input class="tin" id="f-title" data-keep maxlength="90" placeholder="e.g. Grandma's apple crisp" value="${v('title', d.title)}">
    ${r ? '' : `
    ${f.importOk ? '' : `<div class="lbl2">Or paste the recipe</div>
    <textarea class="tin" id="f-paste" data-keep rows="5" placeholder="Copy the recipe from the site and paste it here"></textarea>
    <div class="row" style="margin-top:8px"><button class="btn primary sm" type="button" data-act="parse" id="f-parsebtn" disabled><svg class="bi" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>Download into form</button></div>`}`}
    <fieldset class="lockable" ${!r && !f.filled ? 'disabled' : ''}>
    <div class="g4">
      <div><div class="lbl2">Serves / makes</div><input class="tin" id="f-yield" data-keep maxlength="40" value="${v('y', d.yield)}"></div>
      <div><div class="lbl2">Prep time</div><input class="tin" id="f-prep" data-keep maxlength="40" value="${v('p', d.prep)}"></div>
      <div><div class="lbl2">Cook time</div><input class="tin" id="f-cook" data-keep maxlength="40" value="${v('c', d.cook)}"></div>
      <div><div class="lbl2">Total time</div><input class="tin" id="f-total" data-keep maxlength="40" value="${v('t', d.total)}"></div>
    </div>
    <div class="lbl2">Ingredients</div>
    <textarea class="tin" id="f-ing" data-keep rows="9">${esc(groupsToIngText(d.ingredients))}</textarea>
    <div class="lbl2">Steps <span class="hint">one per line · <span id="f-stepcount"></span></span></div>
    <textarea class="tin" id="f-steps" data-keep rows="9">${esc(sectionsToStepText(d.steps))}</textarea>
    <details class="steprev"><summary>See them numbered</summary><ol id="f-steplist"></ol></details>
    <div class="lbl2">Notes <span class="hint">optional</span></div>
    <textarea class="tin" id="f-notes" data-keep rows="3">${esc((d.notes || []).join('\n'))}</textarea>
    <div class="lbl2">Image</div>
    <div class="picwrap">
      <div class="picprev" id="f-pic">${photoNow ? `<img src="${esc(photoNow)}" alt="">` : art(guessArt(($('#f-title') || {}).value || d.title || ''), ($('#f-title') || {}).value || d.title || '')}</div>
      <label class="picbtn" title="Upload your own photo" aria-label="Upload your own photo"><input type="file" id="f-photo" accept="image/*" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg></label>
      ${photoNow ? `<button class="picbtn picx" type="button" data-act="rmphoto" title="Use the drawing" aria-label="Use the drawing"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : ''}
    </div>
    ${r && onList(r.id) ? `<label class="cb"><input type="checkbox" id="f-addlist" data-keep> Add new ingredients to list</label>` : ''}
    </fieldset>
    <div class="row" style="margin-top:16px"><button class="btn primary sm" type="button" data-act="saveform" data-id="${r ? esc(r.id) : ''}" ${f.busy || (!r && !f.filled) ? 'disabled' : ''}>${f.busy ? 'Saving…' : r ? 'Save changes' : 'Save recipe'}</button></div>
    ${f.err ? `<div class="err">${esc(f.err)}</div>` : ''}
  </div>`;
}
function fillFromPaste(){
  const raw = ($('#f-paste') || {}).value || '';
  if(!raw.trim()){ toast('Paste the recipe first'); return; }
  const p = parseRecipeText(raw);
  const set = (id, val, force) => { const el = $(id); if(el && val && (force || !el.value.trim())) el.value = val; };
  set('#f-title', p.title); set('#f-yield', p.yield); set('#f-prep', p.prep); set('#f-cook', p.cook); set('#f-total', p.total);
  set('#f-ing', p.ingredients, true); set('#f-steps', p.steps, true); set('#f-notes', p.notes);
  if(!p.ingredients){ toast("Couldn't find ingredients. Paste just the recipe."); return; }
  form.filled = true; form.review = {n: stepLines(p.steps).length, url: (($('#f-link') || {}).value || '').trim(), warn: stepCheck(p.steps, false), src: 'paste'}; render();
  toast('Filled in');
}
async function importLink(){
  const url = (($('#f-link') || {}).value || '').trim();
  if(!/^https?:\/\/\S+\.\S+/i.test(url)){ toast('Paste a full https:// link'); return; }
  if(form.importing) return;
  form.importing = true; form.importMsg = ''; render();
  let p = null, msg = '';
  try{
    const {data, error} = await sb.functions.invoke('import-recipe', {body: {url}});
    if(error) throw error;
    if(data && data.ingredients) p = data; else if(data && data.caption) p = {caption: data.caption}; else msg = (data && data.error) || '';
  }catch(err){ console.error(err); }
  form.importing = false;
  if(!p){ form.importOk = false; form.importMsg = (/share that page/.test(msg) ? "This site doesn't allow imports." : msg || "Couldn't import that link.") + ' Paste it below.'; render(); return; }
  if(p.caption){
    const cap = p.caption.replace(/\s*((?:10|[0-9])\uFE0F?\u20E3|\u{1F51F})\s*/gu, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const pa = $('#f-paste'); if(pa) pa.value = cap;
    const q = parseRecipeText(cap);
    if(!q.ingredients){
      let ls = cap.split('\n').map(l => l.trim()).filter(l => l && !/follow (me|us)|link in (my )?bio|tag (a|your) friend|save (this|for later)|share this|comment ["“]?\w+["”]? (below|and)/i.test(l)).slice(1);
      const t = ls.findIndex(l => /^(pro(fessional)? )?(tips|notes)\b.*:?$/i.test(l.replace(/[^\w\s:]/g, '').trim()));
      if(t >= 0){ q.notes = ls.slice(t + 1).join(' ').split(/\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\uFE0F?\s*/u).map(x => x.trim()).filter(x => x.length > 3).join('\n'); ls = ls.slice(0, t); }
      q.steps = ls.join('\n');
    }
    q.title = (q.title || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, '').trim();
    const set = (id, val, force) => { const el = $(id); if(el && val && (force || !el.value.trim())) el.value = val; };
    set('#f-title', q.title); set('#f-yield', q.yield); set('#f-prep', q.prep); set('#f-cook', q.cook); set('#f-total', q.total);
    set('#f-ing', q.ingredients, true); set('#f-steps', q.steps, true); set('#f-notes', q.notes);
    form.filled = !!(q.title || q.steps); form.importOk = true;
    form.importMsg = q.ingredients ? '✓ Pulled from the Instagram caption. Check it over before saving.' : '✓ Pulled from the Instagram caption. It had no ingredient list, so add those before saving.';
    render(); return;
  }
  const set = (id, val, force) => { const el = $(id); if(el && val && (force || !el.value.trim())) el.value = val; };
  set('#f-title', p.title); set('#f-yield', p.yield); set('#f-prep', p.prep); set('#f-cook', p.cook); set('#f-total', p.total);
  set('#f-ing', p.ingredients, true); set('#f-steps', p.steps, true); set('#f-notes', p.notes);
  if(p.title) $('#f-title').value = p.title;
  form.filled = true; form.importOk = true; form.importMsg = ''; form.review = {n: stepLines(p.steps).length, url: ($('#f-link') || {}).value.trim(), warn: stepCheck(p.steps, true), src: 'link'}; render();
}
function reviewCard(rv){ if(!rv.url && !rv.warn) return ''; return `<div class="importrev">${rv.url ? `<a class="ir-link" href="${esc(rv.url)}" target="_blank" rel="noopener">Compare with original${ICON_EXT}</a>` : ''}${rv.warn ? `<div class="ir-warn">${esc(rv.warn)}</div>` : ''}</div>`; }
function stepLines(t){ return String(t || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !/:$/.test(l)); }
function stepCheck(t, fromSite){
  const ls = stepLines(t), long = ls.some(l => l.length > 450);
  if(fromSite && (ls.length <= 3 || long)) return 'Some steps may be missing or combined. Check them against the original before you save.';
  if(long) return 'A few steps look combined. Give each step its own line.';
  return '';
}
function stepPreview(){ const ls = stepLines(($('#f-steps') || {}).value); const c = $('#f-stepcount'); if(c) c.textContent = ls.length ? `${ls.length} step${ls.length === 1 ? '' : 's'}` : ''; const o = $('#f-steplist'); if(o) o.innerHTML = ls.map(l => `<li>${esc(l)}</li>`).join(''); }
function guessArt(t){ return guessKind(t); }
async function shrink(file, max){
  try{
    const bmp = await createImageBitmap(file); const sc = Math.min(1, (max || 1400) / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', .85));
  }catch(e){ return file; }
}
async function uploadPhoto(recipeId, blob){
  const path = `${user.id}/${recipeId}-${Date.now().toString(36)}.jpg`;
  const {error} = await sb.storage.from('photos').upload(path, blob, {contentType:'image/jpeg', cacheControl:'31536000'});
  if(error) throw error;
  return {path, url: sb.storage.from('photos').getPublicUrl(path).data.publicUrl};
}
async function saveForm(id){
  const f = form, existing = id ? R(id) : null, old = existing ? D(existing) : {};
  const val = s => (($(s) || {}).value || '').trim();
  const title = val('#f-title');
  if(!title){ f.err = 'Add a recipe title.'; render(); return; }
  if(!val('#f-ing')){ f.err = 'Add the ingredients (paste the recipe and tap Download into form).'; render(); return; }
  const ingredients = ingTextToGroups(val('#f-ing'));
  const steps = stepTextToSections(val('#f-steps'), old.steps);
  const link = val('#f-link');
  const data = Object.assign({}, old, {
    title, short: title.length > 22 ? title.slice(0, 20).trim() + '…' : title,
    yield: val('#f-yield'), prep: val('#f-prep'), cook: val('#f-cook'), total: val('#f-total'),
    ingredients, steps, notes: val('#f-notes').split('\n').map(s => s.trim()).filter(Boolean),
    links: /^https?:\/\//i.test(link) ? [{label:'Original recipe', url:link}].concat((old.links || []).filter(l => l.url !== link && l.label !== 'Original recipe')) : (old.links || []).filter(l => l.label !== 'Original recipe'),
    color: old.color || PALETTE[recipes.length % PALETTE.length]
  });
  data.art = guessArt(title);
  const addList = ($('#f-addlist') || {}).checked;
  f.busy = true; f.err = ''; render();
  try{
    let recId = id;
    if(!id){
      const {data: row, error} = await sb.from('recipes').insert({user_id: user.id, sort: Date.now(), data}).select('id, sort, data').single();
      if(error) throw error; recId = row.id; recipes.push(row);
    }
    let oldPath = null;
    if(f.photoBlob){ const up = await uploadPhoto(recId, f.photoBlob); oldPath = old.photoPath; data.photo = up.url; data.photoPath = up.path; }
    else if(f.removePhoto){ oldPath = old.photoPath; delete data.photo; delete data.photoPath; }
    if(id || f.photoBlob){
      const {error} = await sb.from('recipes').update({data}).eq('id', recId); if(error) throw error;
      const row = R(recId); if(row) row.data = data;
    }
    if(oldPath) sb.storage.from('photos').remove([oldPath]).catch(() => {});
    if(!id) mutate(k => { k.progress.active[recId] = false; });
    if(addList) mutate(k => { addIngredientsTo(k, recId, ingredients); k.progress.active[recId] = true; if(k.progress.done) delete k.progress.done[recId]; });
    if(f.photoUrl) URL.revokeObjectURL(f.photoUrl);
    form = null; toast(id ? 'Saved changes' : 'Saved! Tap Add to shopping list when you\'re ready.');
    location.hash = 'r-' + recId; loadRecipes();
  }catch(e){
    console.error(e); f.busy = false; f.err = "Couldn't save: " + ((e && e.message) || 'check your connection and try again.'); render();
  }
}
async function addStarters(){
  try{
    setStatus('busy', 'Adding…');
    const rows = STARTERS.filter(d => d.art === 'pie').map((d, i) => ({user_id: user.id, sort: Date.now() + i, data: d}));
    const {data, error} = await sb.from('recipes').insert(rows).select('id, sort, data');
    if(error) throw error;
    recipes = recipes.concat(data);
    mutate(k => data.forEach(row => { k.progress.active[row.id] = false; }));
    toast('Added Blueberry Pie'); if(data[0]) location.hash = 'r-' + data[0].id; else render();
  }catch(e){ console.error(e); toast("Couldn't add them. Try again."); setStatus('err', 'Not saved'); }
}
async function deleteRecipe(id){
  const r = R(id); if(!r) return;
  try{
    const {error} = await sb.from('recipes').delete().eq('id', id); if(error) throw error;
    if(D(r).photoPath) sb.storage.from('photos').remove([D(r).photoPath]).catch(() => {});
    recipes = recipes.filter(x => x.id !== id);
    mutate(k => removeRecipeFrom(k, id));
    location.hash = 'recipes'; toast('Recipe removed');
  }catch(e){ toast("Couldn't remove it. Try again."); }
}

/* ---------------- account ---------------- */
async function deleteAccount(){
  try{
    setStatus('busy', 'Deleting…');
    queue = []; clearTimeout(flushT);
    const {data: files} = await sb.storage.from('photos').list(user.id, {limit: 1000});
    if(files && files.length) await sb.storage.from('photos').remove(files.map(f => user.id + '/' + f.name));
    const {error} = await sb.rpc('delete_my_account');
    if(error) throw error;
    delOpen = false;
    await sb.auth.signOut();
    location.hash = '';
    authView = {mode:'signin', msg:'Your account and all your data have been deleted.', err:'', busy:false};
    render();
  }catch(e){
    console.error(e); setStatus('err', 'Not deleted');
    toast("Couldn't delete your account. Try again in a minute.");
    const b = document.querySelector('[data-act="delconfirm"]'); if(b) b.disabled = false;
  }
}
let menuOpen = false, delOpen = false, photoBusy = null;
function aisleOrder(){ return [...new Set(kitchen.shopping.sections.concat(allItems().map(i => i.section || 'Other')))]; }
function drawAisles(focus){
  const o = aisleOrder();
  const up = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>', dn = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  $('#modalRoot').innerHTML = `<div class="modal" data-act="mclose"><div class="card aisles" data-stop><h3>Aisle order</h3>
    <ol class="alist">${o.map((s, i) => `<li class="${i === focus ? 'moved' : ''}"><span>${esc(s)}</span><button class="mv" data-act="aislemove" data-i="${i}" data-d="-1" aria-label="Move ${esc(s)} up" ${i === 0 ? 'disabled' : ''}>${up}</button><button class="mv" data-act="aislemove" data-i="${i}" data-d="1" aria-label="Move ${esc(s)} down" ${i === o.length - 1 ? 'disabled' : ''}>${dn}</button></li>`).join('')}</ol>
    <div class="row"><button class="btn primary" data-act="mclose">Done</button></div></div></div>`;
}
/* drag a recipe chip into Past trips */
let drag = null, ghost = null, dragJustEnded = false;
document.addEventListener('pointerdown', e => {
  const c = e.target.closest('[data-drag]'); if(!c || e.button > 0) return;
  drag = {el: c, id: c.dataset.id, x: e.clientX, y: e.clientY, on: false};
});
document.addEventListener('pointermove', e => {
  if(!drag) return;
  if(!drag.on){
    if(Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
    drag.on = true; ghost = drag.el.cloneNode(true); ghost.classList.add('ghost'); document.body.appendChild(ghost); document.body.classList.add('dragging');
  }
  e.preventDefault();
  ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
  const t = document.elementFromPoint(e.clientX, e.clientY), d = $('#tripDrop');
  if(d) d.classList.toggle('over', !!(t && t.closest('#tripDrop')));
}, {passive: false});
function endDrag(e, cancel){
  if(!drag) return;
  const was = drag; drag = null;
  if(!was.on) return;
  dragJustEnded = true; setTimeout(() => { dragJustEnded = false; }, 350);
  const t = cancel ? null : document.elementFromPoint(e.clientX, e.clientY);
  const hit = !!(t && t.closest('#tripDrop'));
  if(ghost){ ghost.remove(); ghost = null; } document.body.classList.remove('dragging');
  const d = $('#tripDrop'); if(d) d.classList.remove('over');
  if(hit) finishRecipeTrip(was.id);
}
document.addEventListener('pointerup', e => endDrag(e, false));
document.addEventListener('pointercancel', e => endDrag(e, true));
function finishRecipeTrip(id){
  const r = R(id); if(!r) return;
  const name = D(r).short || D(r).title, at = new Date().toISOString();
  mutate(k => {
    const marks = k.progress.shop = k.progress.shop || {};
    const its = k.shopping.items.filter(i => (i.recipes || []).includes(id));
    const t = k.progress.trips = k.progress.trips || [];
    if(!(t[0] && t[0].at === at)){ t.unshift({at, rid: id, r: [name], items: its.filter(i => marks[i.id]).map(i => ({id: i.id, n: i.name, q: i.qty || '', s: marks[i.id]}))}); if(t.length > 60) t.length = 60; }
    its.forEach(i => { if((i.recipes || []).length === 1) delete marks[i.id]; });
    k.progress.active[id] = false;
    (k.progress.done = k.progress.done || {})[id] = true;
  });
  toast(name + ' moved to Past trips');
}
function newTrip(clearRest){
  const at = new Date().toISOString(), live = recipes.filter(r => isActive(r.id) && !(P().done || {})[r.id]);
  const fin0 = live.filter(r => { const its = allItems().filter(i => (i.recipes || []).includes(r.id)); return its.length && its.every(i => P().shop[i.id]); });
  const moved = fin0.map(r => D(r).short || D(r).title);
  mutate(k => {
    const marks = k.progress.shop = k.progress.shop || {}, logged = k.progress.logged = k.progress.logged || {};
    Object.keys(logged).forEach(id => { if(!marks[id]) delete logged[id]; });
    const itemsOf = id => k.shopping.items.filter(i => (i.recipes || []).includes(id));
    const fin = live.filter(r => { const its = itemsOf(r.id); return its.length && its.every(i => marks[i.id]); }).map(r => r.id);
    const loose = k.shopping.items.filter(i => !(i.recipes || []).some(x => R(x)) && marks[i.id]);
    const shown = k.shopping.items.filter(i => marks[i.id] && !logged[i.id] && ((i.recipes || []).some(x => live.some(r => r.id === x)) || loose.includes(i)));
    const names = live.filter(r => fin.includes(r.id) || shown.some(i => (i.recipes || []).includes(r.id))).map(r => D(r).short || D(r).title);
    const t = k.progress.trips = k.progress.trips || [];
    if((shown.length || fin.length) && !(t[0] && t[0].at === at)){
      t.unshift({at, rids: fin, r: names, items: shown.map(i => Object.assign({id: i.id, n: i.name, q: i.qty || '', s: marks[i.id]}, loose.includes(i) ? {c: 1, sec: i.section || 'Other'} : {}))});
      if(t.length > 60) t.length = 60;
    }
    fin.forEach(id => { k.progress.active[id] = false; (k.progress.done = k.progress.done || {})[id] = true; });
    const stillNeeded = i => (i.recipes || []).some(x => live.some(r => r.id === x) && !fin.includes(x));
    k.shopping.items.forEach(i => { if(marks[i.id] && !stillNeeded(i) && !loose.includes(i)){ delete marks[i.id]; delete logged[i.id]; } });
    loose.forEach(i => { delete marks[i.id]; delete logged[i.id]; });
    Object.keys(marks).forEach(id => { if(marks[id] === 'bought') marks[id] = 'have'; });
    k.shopping.items = k.shopping.items.filter(i => !loose.includes(i));
    shown.forEach(i => { if(marks[i.id]) logged[i.id] = true; });
    if(clearRest){
      const liveIds = live.map(r => r.id);
      k.shopping.items = k.shopping.items.filter(i => {
        if(i.custom && !(i.recipes || []).some(x => R(x))){ delete marks[i.id]; delete logged[i.id]; return false; }
        if(!(i.recipes || []).some(x => liveIds.includes(x))) return true;
        i.recipes = i.recipes.filter(x => !liveIds.includes(x)); if(i.recipes.length) return true;
        delete marks[i.id]; delete logged[i.id]; return false;
      });
      liveIds.forEach(id => { k.progress.active[id] = false; (k.progress.done = k.progress.done || {})[id] = true; });
    }
  });
  toast(clearRest ? 'Trip saved. Your list is cleared.' : moved.length ? moved.join(', ') + ' moved to Past trips' : 'Trip saved. Your list is ready.');
}
/* enter-kitchen gate */
let gate = 'gate';
try{ if(sessionStorage.getItem('mb-in')) gate = 'in'; }catch(e){}
const KITCHEN_ART = `<svg class="kart" aria-hidden="true" viewBox="0 0 200 160"><rect width="200" height="160" rx="22" fill="#FBF6EC"/><g fill="#141414"><rect x="0" y="148" width="6" height="6"/><rect x="6" y="154" width="6" height="6"/><rect x="12" y="148" width="6" height="6"/><rect x="18" y="154" width="6" height="6"/><rect x="24" y="148" width="6" height="6"/><rect x="30" y="154" width="6" height="6"/><rect x="36" y="148" width="6" height="6"/><rect x="42" y="154" width="6" height="6"/><rect x="48" y="148" width="6" height="6"/><rect x="54" y="154" width="6" height="6"/><rect x="60" y="148" width="6" height="6"/><rect x="66" y="154" width="6" height="6"/><rect x="72" y="148" width="6" height="6"/><rect x="78" y="154" width="6" height="6"/><rect x="84" y="148" width="6" height="6"/><rect x="90" y="154" width="6" height="6"/><rect x="96" y="148" width="6" height="6"/><rect x="102" y="154" width="6" height="6"/><rect x="108" y="148" width="6" height="6"/><rect x="114" y="154" width="6" height="6"/><rect x="120" y="148" width="6" height="6"/><rect x="126" y="154" width="6" height="6"/><rect x="132" y="148" width="6" height="6"/><rect x="138" y="154" width="6" height="6"/><rect x="144" y="148" width="6" height="6"/><rect x="150" y="154" width="6" height="6"/><rect x="156" y="148" width="6" height="6"/><rect x="162" y="154" width="6" height="6"/><rect x="168" y="148" width="6" height="6"/><rect x="174" y="154" width="6" height="6"/><rect x="180" y="148" width="6" height="6"/><rect x="186" y="154" width="6" height="6"/><rect x="192" y="148" width="6" height="6"/><rect x="198" y="154" width="6" height="6"/></g><rect x="26" y="32" width="148" height="116" fill="#fff" stroke="#141414" stroke-width="3.5"/><rect x="18" y="20" width="164" height="14" rx="4" fill="#141414"/><rect x="20.0" y="38" width="17.8" height="22" fill="#D7263D"/><rect x="37.8" y="38" width="17.8" height="22" fill="#fff"/><rect x="55.6" y="38" width="17.8" height="22" fill="#D7263D"/><rect x="73.3" y="38" width="17.8" height="22" fill="#fff"/><rect x="91.1" y="38" width="17.8" height="22" fill="#D7263D"/><rect x="108.9" y="38" width="17.8" height="22" fill="#fff"/><rect x="126.7" y="38" width="17.8" height="22" fill="#D7263D"/><rect x="144.4" y="38" width="17.8" height="22" fill="#fff"/><rect x="162.2" y="38" width="17.8" height="22" fill="#D7263D"/><circle cx="28.9" cy="60" r="8.9" fill="#D7263D" stroke="#141414" stroke-width="2.6"/><circle cx="46.7" cy="60" r="8.9" fill="#fff" stroke="#141414" stroke-width="2.6"/><circle cx="64.4" cy="60" r="8.9" fill="#D7263D" stroke="#141414" stroke-width="2.6"/><circle cx="82.2" cy="60" r="8.9" fill="#fff" stroke="#141414" stroke-width="2.6"/><circle cx="100.0" cy="60" r="8.9" fill="#D7263D" stroke="#141414" stroke-width="2.6"/><circle cx="117.8" cy="60" r="8.9" fill="#fff" stroke="#141414" stroke-width="2.6"/><circle cx="135.6" cy="60" r="8.9" fill="#D7263D" stroke="#141414" stroke-width="2.6"/><circle cx="153.3" cy="60" r="8.9" fill="#fff" stroke="#141414" stroke-width="2.6"/><circle cx="171.1" cy="60" r="8.9" fill="#D7263D" stroke="#141414" stroke-width="2.6"/><rect x="18" y="35" width="164" height="5" rx="2" fill="#141414"/><rect x="36" y="82" width="90" height="40" rx="3" fill="#DDEFF5" stroke="#141414" stroke-width="2.8"/><rect x="47" y="106" width="12" height="5" rx="2.5" fill="#D7263D" stroke="#141414" stroke-width="1.8"/><path d="M53 111v11" stroke="#141414" stroke-width="2"/><rect x="73" y="106" width="12" height="5" rx="2.5" fill="#D7263D" stroke="#141414" stroke-width="1.8"/><path d="M79 111v11" stroke="#141414" stroke-width="2"/><rect x="99" y="106" width="12" height="5" rx="2.5" fill="#D7263D" stroke="#141414" stroke-width="1.8"/><path d="M105 111v11" stroke="#141414" stroke-width="2"/><path d="M36 102h90" stroke="#141414" stroke-width="3"/><path d="M44 94 l12-10" stroke="#fff" stroke-width="3" stroke-linecap="round"/><rect x="136" y="82" width="28" height="66" rx="3" fill="#D7263D" stroke="#141414" stroke-width="3"/><circle cx="150.0" cy="96" r="7" fill="#DDEFF5" stroke="#141414" stroke-width="2.5"/><circle cx="158" cy="122" r="2.2" fill="#141414"/><rect x="26" y="126" width="110" height="22" fill="#D7263D" stroke="#141414" stroke-width="3"/><path d="M26 134h110" stroke="#fff" stroke-width="2.5"/><path d="M24 148h152" stroke="#141414" stroke-width="3"/></svg>`;
const POT_ART = `<svg class="pot" viewBox="0 0 160 140" aria-hidden="true">
  <g class="spoon"><path d="M80 66 L112 8" stroke="#141414" stroke-width="9" stroke-linecap="round"/><path d="M80 66 L112 8" stroke="#C98B4E" stroke-width="5" stroke-linecap="round"/><ellipse cx="78" cy="72" rx="7" ry="11" fill="#C98B4E" stroke="#141414" stroke-width="3" transform="rotate(29 78 72)"/></g>
  <g class="drops" fill="#F4C9A6" stroke="#141414" stroke-width="2.5"><circle cx="44" cy="52" r="4.5"/><circle cx="116" cy="50" r="4"/><circle cx="58" cy="44" r="3.2"/><circle cx="102" cy="42" r="3.5"/></g>
  <path class="batter" d="M22 60 C34 44 52 40 66 46 C78 51 86 41 100 42 C116 43 128 50 138 60 Z" fill="#F4C9A6" stroke="#141414" stroke-width="3" stroke-linejoin="round"/>
  <path d="M18 62h124c0 34-27 58-62 58S18 96 18 62z" fill="#D7263D" stroke="#141414" stroke-width="4" stroke-linejoin="round"/>
  <rect x="12" y="56" width="136" height="12" rx="6" fill="#fff" stroke="#141414" stroke-width="4"/>
  <rect x="58" y="118" width="44" height="10" rx="5" fill="#D7263D" stroke="#141414" stroke-width="4"/>
  <path d="M34 78c2 10 8 19 16 25" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".55"/>
</svg>`;
const AUTH_ART = `<svg viewBox="0 0 400 170" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="400" height="170" fill="#FBF6EC"/><rect x="0" y="0" width="14" height="170" fill="#D7263D" opacity="0.09"/><rect x="28" y="0" width="14" height="170" fill="#D7263D" opacity="0.09"/><rect x="56" y="0" width="14" height="170" fill="#D7263D" opacity="0.09"/><rect x="84" y="0" width="14" height="170" fill="#D7263D" opacity="0.09"/><rect x="112" y="0" width="14" height="170" fill="#D7263D" opacity="0.09"/><rect x="140" y="0" width="14" height="170" fill="#D7263D" opacity="0.09"/><rect x="168" y="0" width="14" height="170" fill="#D7263D" opacity="0.09"/><rect x="196" y="0" width="14" height="170" fill="#D7263D" opacity="0.09"/><rect x="224" y="0" width="14" height="170" fill="#D7263D" opacity="0.09"/><rect x="252" y="0" width="14" height="170" fill="#D7263D" opacity="0.09"/><rect x="280" y="0" width="14" height="170" fill="#D7263D" opacity="0.09"/><rect x="308" y="0" width="14" height="170" fill="#D7263D" opacity="0.09"/><rect x="336" y="0" width="14" height="170" fill="#D7263D" opacity="0.09"/><rect x="364" y="0" width="14" height="170" fill="#D7263D" opacity="0.09"/><rect x="392" y="0" width="14" height="170" fill="#D7263D" opacity="0.09"/><rect x="0" y="0" width="400" height="14" fill="#D7263D" opacity="0.09"/><rect x="0" y="28" width="400" height="14" fill="#D7263D" opacity="0.09"/><rect x="0" y="56" width="400" height="14" fill="#D7263D" opacity="0.09"/><rect x="0" y="84" width="400" height="14" fill="#D7263D" opacity="0.09"/><rect x="0" y="112" width="400" height="14" fill="#D7263D" opacity="0.09"/><rect x="0" y="140" width="400" height="14" fill="#D7263D" opacity="0.09"/><rect x="0" y="168" width="400" height="14" fill="#D7263D" opacity="0.09"/><ellipse cx="200" cy="150" rx="92" ry="9" fill="#141414" opacity=".12"/><svg x="130" y="14" width="140" height="122.5" viewBox="0 0 160 140">
  <g class="spoon"><path d="M80 66 L112 8" stroke="#141414" stroke-width="9" stroke-linecap="round"/><path d="M80 66 L112 8" stroke="#C98B4E" stroke-width="5" stroke-linecap="round"/><ellipse cx="78" cy="72" rx="7" ry="11" fill="#C98B4E" stroke="#141414" stroke-width="3" transform="rotate(29 78 72)"/></g>
  <path class="batter" d="M22 60 C34 44 52 40 66 46 C78 51 86 41 100 42 C116 43 128 50 138 60 Z" fill="#F4C9A6" stroke="#141414" stroke-width="3" stroke-linejoin="round"/>
  <path d="M18 62h124c0 34-27 58-62 58S18 96 18 62z" fill="#D7263D" stroke="#141414" stroke-width="4" stroke-linejoin="round"/>
  <rect x="12" y="56" width="136" height="12" rx="6" fill="#fff" stroke="#141414" stroke-width="4"/>
  <rect x="58" y="118" width="44" height="10" rx="5" fill="#D7263D" stroke="#141414" stroke-width="4"/>
  <path d="M34 78c2 10 8 19 16 25" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".55"/>
</svg><g fill="#D7263D" opacity=".55"><path d="M70 40l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/><path d="M330 52l2.4 5.6 5.6 2.4-5.6 2.4-2.4 5.6-2.4-5.6-5.6-2.4 5.6-2.4z"/><path d="M300 118l2 4.6 4.6 2-4.6 2-2 4.6-2-4.6-4.6-2 4.6-2z"/></g></svg>`;
function renderGate(){
  if(gate === 'loading') return `<div class="gate"><div class="loader" aria-label="Loading">${POT_ART}
    <div class="ltext">Loading<span class="dots"><i>.</i><i>.</i><i>.</i></span></div></div></div>`;
  return `<div class="gate"><div class="gatecard">${KITCHEN_ART}
    <button class="btn primary big" data-act="enter">Enter your kitchen</button></div></div>`;
}
function enterKitchen(){
  gate = 'loading'; render();
  const t0 = Date.now();
  const go = () => { if(!loaded) return setTimeout(go, 150); setTimeout(() => {
    gate = 'in'; try{ sessionStorage.setItem('mb-in', '1'); }catch(e){}
    render(); app.classList.add('fadein'); setTimeout(() => app.classList.remove('fadein'), 700);
  }, Math.max(0, 1600 - (Date.now() - t0))); };
  go();
}
let isAdmin = false, adminData = null, adminBusy = false, adminUsage = null;
function renderAdmin(){
  const back = `<button class="back" data-act="go" data-h="shopping">← Back</button><h2 class="ptitle">Admin</h2>`;
  if(!isAdmin) return back + `<div class="card empty">This page is only for the site administrator.</div>`;
  if(!adminData && !adminBusy){
    adminBusy = true;
    sb.rpc('admin_users').then(({data, error}) => { adminBusy = false; adminData = error ? {err: true} : (data || []); render(); });
    sb.rpc('admin_usage').then(({data, error}) => { adminUsage = error ? {err: true} : data; render(); }, () => {});
  }
  if(!adminData) return back + `<div class="card empty">Loading…</div>`;
  if(adminData.err) return back + `<div class="card empty">Couldn't load members.</div>`;
  const fmtD = t => t ? new Date(t).toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'}) : '—';
  return back + renderHealth() + `<div class="card panel"><h3>Members <small>${adminData.length}</small></h3>
    <div class="atable">${adminData.map(u => `<div class="arow"><div><b>${esc(u.name || '—')}</b><div class="muted">${esc(u.email)}</div></div><div class="muted">Joined ${fmtD(u.created_at)}<br>Last in ${fmtD(u.last_sign_in_at)}<br>${u.recipes} recipe${u.recipes == 1 ? '' : 's'}</div></div>`).join('')}</div></div>`;
}
function renderHealth(){
  const u = adminUsage;
  if(!u) return `<div class="card panel health"><h3>Site health</h3><div class="muted">Checking…</div></div>`;
  if(u.err) return `<div class="card panel health"><h3>Site health</h3><div class="muted">Couldn't check usage right now.</div></div>`;
  const MB = 1024 * 1024, mb = b => (b / MB < 10 ? (b / MB).toFixed(1) : Math.round(b / MB)) + ' MB';
  const rows = [
    ['Recipes & lists', u.db_bytes, 500 * MB, mb(u.db_bytes) + ' of 500 MB'],
    ['Photos', u.storage_bytes, 1024 * MB, mb(u.storage_bytes) + ' of 1 GB'],
    ['Members', u.users, 50000, u.users.toLocaleString() + ' of 50,000'],
  ];
  const days = u.last_active ? Math.floor((Date.now() - new Date(u.last_active)) / 864e5) : null;
  const worst = Math.max(...rows.map(r => r[1] / r[2]));
  const warn = worst >= .8 ? `<div class="hwarn red">Something is close to the free limit. Time to clean up or upgrade Supabase.</div>` : worst >= .6 ? `<div class="hwarn">Getting fuller. Keep an eye on it.</div>` : `<div class="hok">✓ Everything's well within the free limits.</div>`;
  return `<div class="card panel health"><h3>Site health</h3>${warn}
    ${rows.map(([n, v, max, label]) => { const p = Math.min(100, v / max * 100); return `<div class="hrow"><div class="hlbl"><span>${n}</span><span class="muted">${label}</span></div><div class="hbar ${p >= 80 ? 'red' : p >= 60 ? 'amber' : ''}"><i style="width:${Math.max(p, 1.5)}%"></i></div></div>`; }).join('')}
    <div class="muted" style="font-size:14px;margin-top:6px">Last sign-in: ${days === null ? '—' : days === 0 ? 'today' : days + ' day' + (days === 1 ? '' : 's') + ' ago'}. Supabase pauses free sites after 7 quiet days.</div>
    <div class="row" style="margin-top:12px"><button class="btn" data-act="backup"><svg class="bi" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>Download backup</button></div>
    <div class="muted" style="font-size:12px;margin-top:6px">Saves every member's recipes, lists and progress to a file. Photos aren't included.</div></div>`;
}
async function downloadBackup(){
  toast('Preparing backup…');
  const {data, error} = await sb.rpc('admin_backup');
  if(error){ console.error(error); toast("Couldn't create the backup"); return; }
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'mixingbowl-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Backup downloaded');
}
function restoreTrip(at){
  const trip = (P().trips || []).find(x => x.at === at); if(!trip) return;
  const ids = trip.rids ? trip.rids : trip.rid ? [trip.rid] : recipes.filter(r => (trip.r || []).includes(D(r).short || D(r).title)).map(r => r.id);
  mutate(k => {
    const t = k.progress.trips || []; const i = t.findIndex(x => x.at === at); if(i < 0) return;
    const marks = k.progress.shop = k.progress.shop || {};
    ids.forEach(id => { k.progress.active[id] = true; if(k.progress.done) delete k.progress.done[id]; });
    (t[i].items || []).forEach(it => {
      const item = (it.id && k.shopping.items.find(x => x.id === it.id)) || k.shopping.items.find(x => x.name === it.n && (!ids.length || (x.recipes || []).some(r => ids.includes(r))));
      if(item) marks[item.id] = it.s;
      else if(it.c){ const nid = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); k.shopping.items.push({id: nid, name: it.n, qty: it.q || '', section: it.sec || 'Other', key: splitIngredient(it.n).key, recipes: [], custom: true}); marks[nid] = it.s; }
    });
    t.splice(i, 1);
  });
  toast((trip.r && trip.r.length ? trip.r.join(', ') : 'Trip') + ' is back on your list');
  location.hash = 'shopping';
}
function renderTrips(){
  const trips = P().trips || [];
  const list = (arr) => `<ul class="tlist">${arr.map(i => `<li><span>${esc(i.n)}${i.q ? ` <span class="q">· ${fmt(i.q)}</span>` : ''}</span><button class="readd" data-act="readd" data-iid="${esc(i.id || '')}" data-n="${esc(i.n)}" data-q="${esc(i.q || '')}" title="Add to list" aria-label="Add ${esc(i.n)} to list">+</button></li>`).join('')}</ul>`;
  const days = [];
  trips.forEach(t => { const key = new Date(t.at).toDateString(); const g = days.find(x => x.key === key); if(g) g.trips.push(t); else days.push({key, trips: [t]}); });
  const body = days.map((g, n) => {
    const d = new Date(g.trips[0].at), all = g.trips.flatMap(t => t.items || []);
    const names = [...new Set(g.trips.flatMap(t => t.r || []))];
    const when = d.toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'});
    const seen = new Map(); all.forEach(i => { const key = i.id || i.n; if(!seen.has(key)) seen.set(key, i); });
    const uniq = [...seen.values()], gt = uniq.filter(i => i.s === 'bought'), hd = uniq.filter(i => i.s === 'have');
    const ats = g.trips.map(t => t.at).join('|');
    return `<details class="card trip" ${n === 0 ? 'open' : ''}><summary><div><b>${esc(when)}</b><div class="muted">${gt.length} bought · ${hd.length} already had</div></div><span class="chev">▾</span></summary>
      <div class="tbody">${names.length ? `<div class="tname">${esc(names.join(', '))}</div>` : ''}
      ${uniq.length ? `<details class="tings"><summary>See ingredients</summary>${gt.length ? `<h4>Bought</h4>${list(gt)}` : ''}${hd.length ? `<h4>Already had</h4>${list(hd)}` : ''}</details>` : '<div class="muted" style="font-size:14px">Nothing was marked.</div>'}
      <div class="row" style="margin-top:12px"><button class="btn" data-act="untrip" data-at="${esc(ats)}"><svg class="bi" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 10.5a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2L20 8H6.2"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/></svg>Back to shopping list</button></div></div></details>`;
  }).join('');
  return `<button class="back" data-act="go" data-h="shopping">← Shopping list</button>
  <h2 class="ptitle">Past trips</h2>
  ${trips.length ? `<div class="trips">${body}</div>` : `<div class="card empty">No trips yet. They're saved when you start a new one.</div>`}`;
}
function renderMenu(){
  return `<div class="umenu" role="menu">
    <div class="umhead"><b>${esc(firstName() || 'Your kitchen')}</b><span>${esc(user.email)}</span></div>
    <button role="menuitem" data-act="go" data-h="help"><span class="ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.4"/><path d="M12 17h.01"/></svg></span>How it works</button>
    <button role="menuitem" data-act="go" data-h="settings"><span class="ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></span>Settings</button>
    <button role="menuitem" data-act="go" data-h="account"><span class="ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></span>Account</button>
    ${isAdmin ? `<button role="menuitem" data-act="go" data-h="admin"><span class="ic"><svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg></span>Admin</button>` : ''}
    <button role="menuitem" data-act="go" data-h="feedback"><span class="ic"><svg viewBox="0 0 24 24"><path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/></svg></span>Send feedback</button>
    <button role="menuitem" data-act="go" data-h="privacy"><span class="ic"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/><path d="M12 15v2.5"/></svg></span>Privacy</button>
    <button role="menuitem" class="out" data-act="signout"><span class="ic"><svg viewBox="0 0 24 24"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M15 16l4-4-4-4"/><path d="M19 12H10"/></svg></span>Exit kitchen</button>
  </div>`;
}
function renderSettings(){
  return `<button class="back" data-act="go" data-h="recipes">← Back</button>
  <div class="card panel"><h3>Settings</h3>
    <div class="lbl2">Your name </div>
    <form data-form="name" class="row"><input class="tin" id="acc-name" data-keep style="flex:1;min-width:160px" value="${esc(firstName())}" maxlength="40" required><button class="btn primary" type="submit">Save name</button></form>
  </div>
  <div class="card panel" style="margin-top:16px"><h3>Change password</h3>
    <form data-form="password" class="stack" autocomplete="off">
      <input class="tin" id="pw-cur" type="password" placeholder="Current password" required autocomplete="current-password">
      <input class="tin" id="pw-new" type="password" placeholder="New password (6+ characters)" minlength="6" required autocomplete="new-password">
      <input class="tin" id="pw-new2" type="password" placeholder="Type the new password again" minlength="6" required autocomplete="new-password">
      <div><button class="btn primary" type="submit">Update password</button></div>
    </form>
  </div>
  <div class="card panel" style="margin-top:16px"><h3>Add Mixing Bowl to your Home Screen</h3>
    <p class="muted" style="margin:6px 0 10px">This site is not yet available in the App Store. Follow the steps below to add it to your phone's Home Screen.</p>
    <p style="margin:6px 0"><b>iPhone:</b> open this site in Safari, tap Share, then <b>Add to Home Screen</b>.</p>
    <p style="margin:6px 0"><b>Android:</b> open it in Chrome, tap ⋮, then <b>Add to Home screen</b>.</p>
  </div>`;
}
function renderAccount(){
  const since = user.created_at ? new Date(user.created_at).toLocaleDateString(undefined, {month:'long', day:'numeric', year:'numeric'}) : '';
  return `<button class="back" data-act="go" data-h="recipes">← Back</button>
  <div class="card panel"><h3>Account</h3>
    <div class="lbl2">Email</div><div>${esc(user.email)}</div>
    ${since ? `<div class="lbl2">Member since</div><div>${esc(since)}</div>` : ''}
    <div class="lbl2">What's saved</div><div>${recipes.length} recipe${recipes.length === 1 ? '' : 's'} · ${allItems().length} shopping list item${allItems().length === 1 ? '' : 's'}</div>
  </div>
  <div class="card panel danger" style="margin-top:16px"><h3>Delete account</h3>
    <p style="margin:6px 0 12px">Permanently deletes your account, all your recipes and photos, your shopping list and your cooking progress. This can't be undone.</p>
    <button class="btn dangerbtn" data-act="delopen">Delete my account and data</button>
  </div>
  ${delOpen ? `<div class="modal" data-act="delclose"><div class="card" data-stop><h3>Delete everything?</h3>
    <div class="muted">Deletes your account and data for good. Type <b>DELETE</b> to confirm.</div>
    <input class="tin" id="del-word" autocomplete="off" style="margin-top:12px" placeholder="DELETE">
    <div class="row"><button class="btn" data-act="delclose">Cancel</button><button class="btn dangerbtn" data-act="delconfirm">Delete forever</button></div></div></div>` : ''}`;
}
const FB_EMAIL = 'mixingbowl.admin@gmail.com';
function renderFeedback(){
  const su = encodeURIComponent('Mixing Bowl feedback');
  return `<button class="back" data-act="go" data-h="${user ? 'recipes' : ''}">← Back</button>
  <div class="card panel prose fb"><h3>Send feedback</h3>
    <p>Ideas, bugs or questions? Email us at <b>${FB_EMAIL}</b>.</p>
    <div class="fbbtns"><button class="btn primary sm" data-act="copyemail">Copy email address</button></div>
  </div>`;
}
const TOUR = [
  {art: () => `<svg class="tourico" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 16c-6-5-14-6-22-5v38c8-1 16 0 22 5c6-5 14-6 22-5V11c-8-1-16 0-22 5z"/><path d="M32 16v38"/><path d="M18 22h8M18 30h8M38 22h8" class="accl"/></svg>`, title: 'Plan your recipes', text: 'Save your recipes by pasting the URL or the recipe steps into the recipe form.'},
  {art: () => `<svg class="tourico" viewBox="0 0 64 64" aria-hidden="true"><rect x="12" y="10" width="32" height="44" rx="5"/><path d="M20 22h16M20 30h16M20 38h10"/><circle cx="46" cy="44" r="10" class="acc"/><path d="M46 39v10M41 44h10" class="w"/></svg>`, title: 'Add to your shopping list', text: 'When you\'re ready to shop, open a recipe and tap <b>Add to shopping list</b>. Add as many recipes as you like.'},
  {art: () => `<svg class="tourico" viewBox="0 0 64 64" aria-hidden="true"><path d="M6 12h7l6 28h28l5-20H16"/><circle cx="23" cy="50" r="4"/><circle cx="43" cy="50" r="4"/><path d="M29 30l3 3 6-6" class="accl"/></svg>`, title: 'Shop for groceries', text: 'Your ingredients are grouped by grocery aisle, like Produce and Dairy, and you can reorder the aisles. Check things off as you shop, or tap <b>Have it</b> for anything already in your kitchen.'},
  {art: () => `<svg class="tourico" viewBox="0 0 64 64" aria-hidden="true"><path d="M10 30h44v6c0 10-8 18-18 18h-8c-10 0-18-8-18-18z"/><path d="M6 30h52"/><path d="M24 22c-3-4 3-6 0-11M32 22c-3-4 3-6 0-11M40 22c-3-4 3-6 0-11" class="accl"/></svg>`, title: 'Cook at home', text: 'Follow along with your recipes as you cook. Each one lists every ingredient, amount, and step, and you can check them off as you go.'},
  {art: () => `<svg class="tourico" viewBox="0 0 64 64" aria-hidden="true"><rect x="14" y="8" width="36" height="48" rx="4"/><path d="M14 16h-4M14 28h-4M14 40h-4"/><path d="M24 20h16M24 28h16M24 36h10"/><path d="M38 44l4 4 8-9" class="accl"/></svg>`, title: 'Add to your cookbook', text: 'Use the Recipes page as your own personal cookbook to store as many recipes as you\'d like.'},
  {art: () => `<svg class="tourico" viewBox="0 0 64 64" aria-hidden="true"><circle cx="22" cy="22" r="7"/><path d="M8 48c1-8 7-13 14-13s13 5 14 13"/><circle cx="43" cy="24" r="6"/><path d="M38 36c2-1 3.5-1.5 5-1.5c6 0 11 4.5 12 11.5"/><path d="M47 6c-2-2.5-6-1-5 2c.6 2 5 5 5 5s4.4-3 5-5c1-3-3-4.5-5-2z" class="acc"/></svg>`, title: 'Share with friends', text: 'Add friends in the <b>Friends</b> tab to see each other\'s recipes. Save any of theirs to your cookbook, or send them one of yours.'},
];
let tourStep = -1;
function showTour(i){
  tourStep = i; const t = TOUR[i], last = i === TOUR.length - 1;
  $('#modalRoot').innerHTML = `<div class="modal"><div class="card tour" data-stop>
    <div class="tourart">${t.art()}</div>
    <div class="tourbody"><div class="tourdots">${TOUR.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>
    <h3>${t.title}</h3><p>${t.text}</p>
    <div class="row tourbtns">${i ? `<button class="btn" data-act="tourgo" data-i="${i - 1}">Back</button>` : `<button class="btn outline" data-act="tourend">Skip</button>`}<button class="btn primary" data-act="${last ? 'tourend' : 'tourgo'}" data-i="${i + 1}">${last ? 'Let\'s cook' : 'Next'}</button></div></div>
  </div></div>`;
}
function maybeTour(){
  if(tourStep >= 0 || !kitchen || P().tourDone || recipes.length || allItems().length) return;
  showTour(0);
}
function renderHelp(){
  const step = (n, t) => `<div class="hstep"><div class="hnum">${n}</div><div><h4>${t.title}</h4><p>${t.text}</p></div></div>`;
  return `<button class="back" data-act="go" data-h="recipes">← Back</button>
  <div class="card panel prose help"><h3>How Mixing Bowl works</h3>
    <p class="muted">Plan, shop and cook from one place.</p>
    ${TOUR.map((t, i) => step(i + 1, t)).join('')}
    <h4 class="htips">Good to know</h4>
    <ul>
      <li><b>Add a recipe</b> from a website link, or paste the text and tap <b>Download into form</b>.</li>
      <li>Tap <b>Add to shopping list</b> on a recipe when you plan to shop for it. Ingredients will not automatically get added to your shopping list.</li>
      <li>Tap <b>Finish trip</b> when you're back from the store. The trip is saved to <b>Past trips</b>, and you can clear anything left on your list.</li>
      <li><b>Reorder aisles</b> with the arrows next to each section so the list matches your store.</li>
      <li><b>Archive</b> recipes you're not making right now, and unarchive them anytime.</li>
      <li><b>Add a friend</b> from the <b>Friends</b> tab using their email or an invite link. Once they accept, you can see each other's recipes.</li>
      <li>Tap <b>+ Save</b> on a friend's recipe to get your own copy. You can edit it without changing theirs.</li>
      <li><b>Send a recipe</b> to a friend from its <b>⋯</b> menu, with a note if you like.</li>
      <li>Turn on <b>Private</b> in a recipe's <b>⋯</b> menu to keep it out of your friends' view. Your shopping list and progress are always private.</li>
      <li><b>Add to your Home Screen</b> from Settings so it opens like an app.</li>
    </ul>
    <div class="row" style="margin-top:14px"><button class="btn" data-act="tourgo" data-i="0">Replay the quick tour</button></div>
  </div>`;
}
function renderTerms(){
  return `<button class="back" data-act="go" data-h="${user ? 'recipes' : ''}">← Back</button>
  <div class="card panel prose"><h3>Terms of Use</h3>
    <p class="muted">Last updated November 13, 2026</p>
    <p><b>Using Mixing Bowl.</b> Mixing Bowl is a free personal project for organizing recipes and shopping lists. It's for personal, non-commercial use and for ages 13 and up.</p>
    <p><b>Your content.</b> What you add is yours, and you're responsible for it. Only save content you have the right to use. Recipes saved from other websites still belong to their creators and are for your own personal use.</p>
    <p><b>Fair use of the site.</b> Don't upload anything illegal, harmful or abusive, and don't try to break, overload or misuse the site or other people's accounts.</p>
    <p><b>Provided as is.</b> Mixing Bowl is offered as is, without warranties of any kind. Features may change, and the site may be paused or shut down. Keep your own copy of anything important.</p>
    <p><b>Liability.</b> To the fullest extent permitted by law, Mixing Bowl is not liable for any loss or damage resulting from your use of the site.</p>
    <p><b>Accounts.</b> You can delete your account at any time from <b>Account</b>. Accounts that break these terms may be suspended or removed.</p>
    <p><b>Changes.</b> These terms may be updated from time to time. Continuing to use Mixing Bowl means you accept the current version.</p>
    <p><b>Contact.</b> Email <a href="mailto:mixingbowl.admin@gmail.com">mixingbowl.admin@gmail.com</a>.</p>
  </div>`;
}
function renderPrivacy(){
  return `<button class="back" data-act="go" data-h="${user ? 'recipes' : ''}">← Back</button>
  <div class="card panel prose"><h3>Your privacy</h3>
    <p><b>Your kitchen is yours.</b> Your recipes, photos, shopping list and progress are tied to your account. Nothing is browsable through the site, and other members can't see your kitchen unless you become friends. As with most websites, the site administrator has technical access to the underlying database and can see a list of member names and email addresses to run the site. Your data is never reviewed, sold, shared or used for advertising.</p>
    <p><b>Friends.</b> When you and another member become friends, you can each see the other's recipes and recipe photos, except ones marked Private or archived, and save copies to your own kitchen. Friends never see your shopping list, cooking progress or favorites. A recipe you send to a friend is shared with them as a copy. Friend requests are sent by email address, and the site never shows whether an email has an account. You can remove a friend at any time, and copies they've already saved stay in their kitchen.</p>
    <p><b>Passwords stay secret.</b> Passwords are stored encrypted. No one, including the site administrator, can see yours.</p>
    <p><b>Photos.</b> Uploaded photos are stored at private, unguessable web addresses that aren't listed anywhere. Anyone with a photo's exact address could open it, so avoid uploading anything sensitive.</p>
    <p><b>Where it's stored.</b> Accounts and data are kept by Supabase, a database service. The website itself is hosted on GitHub Pages.</p>
    <p><b>Leaving.</b> You can delete your account at any time from <b>Account</b>, which permanently removes your account and everything you've saved.</p>
    <p><b>Age.</b> Mixing Bowl is for ages 13 and up.</p>
    <p><b>Questions.</b> Email <a href="mailto:mixingbowl.admin@gmail.com">mixingbowl.admin@gmail.com</a>.</p>
  </div>`;
}

/* ---------------- timers, wake lock, modal ---------------- */
let timers = [], audio = null, tick = null;
function startTimer(min, label){
  try{ audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume && audio.resume(); }catch(e){}
  timers.push({id: rid(), label, end: Date.now() + min * 60000, rang: false}); drawTimers(); if(!tick) tick = setInterval(drawTimers, 1000); toast('Timer started: ' + label);
}
function beep(){ try{ if(!audio) return; for(let i = 0; i < 3; i++){ const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audio.destination); const t = audio.currentTime + i * .45; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.3, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .35); o.start(t); o.stop(t + .4); } }catch(e){} try{ navigator.vibrate && navigator.vibrate([300,150,300]); }catch(e){} }
function drawTimers(){
  const now = Date.now();
  $('#timerWrap').innerHTML = timers.map(t => { const ms = t.end - now; if(ms <= 0 && !t.rang){ t.rang = true; beep(); }
    const s = Math.max(0, Math.ceil(ms / 1000)); const txt = ms <= 0 ? 'Done!' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    return `<div class="timer ${ms <= 0 ? 'ring' : ''}"><span>${esc(t.label)}</span><b>${txt}</b><button data-act="untimer" data-id="${t.id}" aria-label="Dismiss">✕</button></div>`; }).join('');
  if(!timers.length){ clearInterval(tick); tick = null; }
}
let wakeLock = null, wantWake = false;
async function reWake(){ if(wantWake && !wakeLock){ try{ wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; render(); }); }catch(e){} } }
function confirmBox(title, body, okText, fn){
  $('#modalRoot').innerHTML = `<div class="modal" data-act="mclose"><div class="card" data-stop><h3>${esc(title)}</h3><div class="muted">${esc(body)}</div><div class="row"><button class="btn" data-act="mclose">Cancel</button><button class="btn primary" data-act="mok">${esc(okText)}</button></div></div></div>`;
  confirmFn = fn;
}
let confirmFn = null;

/* ---------------- events ---------------- */
document.addEventListener('click', async e => {
  if(dragJustEnded){ dragJustEnded = false; e.preventDefault(); return; }
  if(e.target.closest('[data-stop]') && !e.target.closest('[data-act]')) return;
  const el = e.target.closest('[data-act]');
  if(menuOpen && !(el && el.dataset.act === 'menu')){ menuOpen = false; render(); }
  if(moreOpen && !(el && el.dataset.act === 'more')){ moreOpen = false; render(); }
  if(catOpen && !(el && ['catmenu','catpick','catclear'].includes(el.dataset.act))){ catOpen = false; render(); }
  if(sortOpen && !(el && ['sortmenu','sortpick'].includes(el.dataset.act))){ sortOpen = false; render(); }
  if(fCatOpen && !(el && ['fcatmenu','fcatpick','fcatclear'].includes(el.dataset.act))){ fCatOpen = false; render(); }
  if(fSortOpen && !(el && ['fsortmenu','fsortpick'].includes(el.dataset.act))){ fSortOpen = false; render(); }
  if(!el) return;
  const a = el.dataset.act, id = el.dataset.id, shop = user ? P().shop : {};
  if(a === 'menu'){ menuOpen = !menuOpen; render(); return; }
  if(a === 'heroart'){ const row = R(id); if(!row) return; const old = row.data.photoPath; const data = Object.assign({}, row.data); delete data.photo; delete data.photoPath;
    const {error} = await sb.from('recipes').update({data}).eq('id', id); if(error){ toast("Couldn't change it. Try again."); return; }
    row.data = data; if(old) sb.storage.from('photos').remove([old]).catch(() => {}); render(); toast('Switched back to the drawing'); return; }
  if(a === 'delopen'){ delOpen = true; render(); setTimeout(() => { const w = $('#del-word'); if(w) w.focus(); }, 50); return; }
  if(a === 'delclose'){ if(e.target.closest('[data-stop]') && el.classList.contains('modal')) return; delOpen = false; render(); return; }
  if(a === 'delconfirm'){ if((($('#del-word') || {}).value || '').trim().toUpperCase() !== 'DELETE'){ toast('Type DELETE to confirm'); return; } el.disabled = true; deleteAccount(); return; }
  if(a === 'go'){ if(el.dataset.h === 'admin'){ adminData = null; adminUsage = null; } location.hash = el.dataset.h; return; }
  if(a === 'backup'){ downloadBackup(); return; }
  if(a === 'fcatmenu'){ fCatOpen = !fCatOpen; fSortOpen = false; render(); return; }
  if(a === 'fcatpick'){ const t = el.dataset.t; fCat = fCat.includes(t) ? fCat.filter(x => x !== t) : fCat.concat(t); render(); return; }
  if(a === 'fcatclear'){ fCat = []; fCatOpen = false; render(); return; }
  if(a === 'fsortmenu'){ fSortOpen = !fSortOpen; fCatOpen = false; render(); return; }
  if(a === 'fsortpick'){ fSortK = el.dataset.k; fSortOpen = false; render(); return; }
  if(a === 'addfriend'){ addFriendOpen = true; render(); setTimeout(() => { const i = $('#fr-email'); if(i) i.focus(); }, 60); return; }
  if(a === 'addfriendclose'){ addFriendOpen = false; render(); return; }
  if(a === 'frlink'){ copyInviteLink(); return; }
  if(a === 'fraccept' || a === 'frdecline'){ el.disabled = true; const f = friendBy(id); const {error} = await sb.rpc('respond_friend_request', {friend: id, accept: a === 'fraccept'}); if(error){ toast("Couldn't do that. Try again."); el.disabled = false; return; } if(a === 'fraccept' && f) toast(`You and ${f.name} are now friends`); else if(a === 'frdecline') toast('Request declined'); await loadFriends(true); return; }
  if(a === 'frcancel'){ await sb.rpc('remove_friend', {friend: id}); toast('Request canceled'); loadFriends(true); return; }
  if(a === 'frremove'){ const f = friendBy(id); if(!f) return; const n = savedFrom(f).length;
    $('#modalRoot').innerHTML = `<div class="modal" data-act="mclose"><div class="card rmcard" data-stop><h3>Remove ${esc(f.name)} as a friend?</h3><div class="muted">You'll stop seeing each other's cookbooks.</div>
      <div class="rmbtns">${n ? `<button class="btn primary" data-act="frremoveok" data-id="${esc(id)}">Remove friend but keep shared recipes</button><button class="btn outline danger" data-act="frremoveok" data-id="${esc(id)}" data-del="1">Remove friend and delete shared recipes</button>` : `<button class="btn primary" data-act="frremoveok" data-id="${esc(id)}">Remove friend</button>`}<button class="btn ghost" data-act="mclose">Cancel</button></div></div></div>`; return; }
  if(a === 'frremoveok'){ $('#modalRoot').innerHTML = ''; const f = friendBy(id); const {error} = await sb.rpc('remove_friend', {friend: id}); if(error){ toast("Couldn't remove them. Try again."); return; }
    let gone = 0; if(el.dataset.del && f){ for(const r of savedFrom(f)){ const {error: de} = await sb.from('recipes').delete().eq('id', r.id); if(de) continue; if(D(r).photoPath) sb.storage.from('photos').remove([D(r).photoPath]).catch(() => {}); recipes = recipes.filter(x => x.id !== r.id); mutate(k => removeRecipeFrom(k, r.id)); gone++; } }
    delete fbook[id]; toast(f ? `Removed ${f.name}${gone ? ` and ${gone} recipe${gone === 1 ? '' : 's'}` : ''}` : 'Removed'); location.hash = 'friends'; loadFriends(true); return; }
  if(a === 'shsave' || a === 'shdismiss'){ const sh = inbox.find(x => x.id === id); if(!sh) return; el.disabled = true;
    if(a === 'shsave'){ try{ const fr = (friends || []).find(x => x.status === 'accepted' && x.name === sh.sender_name); const row = await saveCopy(sh.data, fr ? {owner: fr.friend_id, name: sh.sender_name} : {name: sh.sender_name}); toast(`Saved ${D(row).title}`); }catch(err){ toast("Couldn't save it. Try again."); el.disabled = false; return; } }
    await sb.rpc('dismiss_share', {share: id}); inbox = inbox.filter(x => x.id !== id); render(); return; }
  if(a === 'fsave'){ e.stopPropagation(); const fid = el.dataset.f, b = fbook[fid], f = friendBy(fid), row = b && b.rows.find(x => x.id === id); if(!row || !f || savedCopy(fid, id)) return; el.disabled = true;
    try{ const mine = await saveCopy(row.data, {id: row.id, owner: fid, name: f.name}); toast(`Saved to your recipes`); render(); }catch(err){ toast("Couldn't save it. Try again."); el.disabled = false; } return; }
  if(a === 'privtog'){ const on = !isPriv(id); mutate(k => { const p = k.progress.private = k.progress.private || {}; if(on) p[id] = true; else delete p[id]; }); moreOpen = false; render(); toast(on ? 'Private. Only you can see it.' : 'Friends can see this recipe'); return; }
  if(a === 'sendopen'){ moreOpen = false; sendSheet = id; if(friends === null) loadFriends(true); render(); return; }
  if(a === 'sendclose'){ sendSheet = null; render(); return; }
  if(a === 'sendgo'){ const to = [...document.querySelectorAll('.sendck:checked')].map(x => x.value); if(!to.length){ toast('Pick who to send it to'); return; } el.disabled = true;
    const {data, error} = await sb.rpc('send_recipe', {recipe: id, friends: to, msg: (($('#send-note') || {}).value || '').trim()});
    if(error || !data){ toast("Couldn't send it. Try again."); el.disabled = false; return; }
    sendSheet = null; render(); toast(to.length === 1 ? `Sent to ${(friendBy(to[0]) || {}).name || 'your friend'}` : `Sent to ${to.length} friends`); return; }
  if(a === 'invaccept'){ el.disabled = true; await acceptInvite(); return; }
  if(a === 'invno'){ forgetInvite(); inviteInfo = null; render(); return; }
  if(a === 'copyemail'){ try{ await navigator.clipboard.writeText(FB_EMAIL); toast('Email address copied'); }catch(err){ toast(FB_EMAIL); } return; }
  if(a === 'readd'){
    const iid = el.dataset.iid, nm = el.dataset.n, q = el.dataset.q;
    mutate(k => {
      const marks = k.progress.shop = k.progress.shop || {};
      const ex = (iid && k.shopping.items.find(i => i.id === iid)) || k.shopping.items.find(i => i.name === nm);
      const shows = ex && (!(ex.recipes || []).some(x => R(x)) || ex.recipes.some(x => R(x) && k.progress.active[x] !== false && !(k.progress.done || {})[x]));
      if(shows){ delete marks[ex.id]; return; }
      const nid = 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      k.shopping.items.push({id: nid, name: nm, qty: q, section: (ex && ex.section) || 'Other', key: splitIngredient(nm).key, recipes: [], custom: true});
    });
    toast(nm + ' added to list'); return;
  }
  if(a === 'tourgo'){ showTour(+el.dataset.i); return; }
  if(a === 'tourend'){ $('#modalRoot').innerHTML = ''; tourStep = -1; if(!P().tourDone) mutate(k => { k.progress.tourDone = true; }); return; }
  if(a === 'untrip'){ el.dataset.at.split('|').forEach(at => restoreTrip(at)); return; }
  if(a === 'authmode'){ authView = {mode: el.dataset.m, msg:'', err:'', busy:false}; render(); return; }
  if(a === 'bought'){ const v = shop[id] === 'bought' ? '' : 'bought'; mutate(k => { k.progress.shop[id] = v; }); return; }
  if(a === 'have'){ const v = shop[id] === 'have' ? '' : 'have'; mutate(k => { k.progress.shop[id] = v; }); return; }
  if(a === 'active'){ const v = !isActive(id); mutate(k => { k.progress.active[id] = v; }); return; }
  if(a === 'relist'){ const r = R(id); mutate(k => { if(r && !k.shopping.items.some(i => (i.recipes || []).includes(id))) addIngredientsTo(k, id, D(r).ingredients || []); k.progress.active[id] = true; if(k.progress.done) delete k.progress.done[id]; }); toast('Added to your shopping list'); return; }
  if(a === 'filter'){ ui.filter = el.dataset.f; saveUi(); render(); return; }
  if(a === 'delitem'){ const it = allItems().find(i => i.id === id); mutate(k => { k.shopping.items = k.shopping.items.filter(i => i.id !== id); delete k.progress.shop[id]; }); if(it) toast('Removed ' + it.name); return; }
  if(a === 'copy'){
    const items = visibleItems().filter(i => !shop[i.id]); const secs = [...new Set(items.map(i => i.section || 'Other'))];
    const txt = secs.map(s => s + ':\n' + items.filter(i => (i.section || 'Other') === s).map(i => '- ' + i.name + (i.qty ? ' (' + i.qty + ')' : '')).join('\n')).join('\n\n');
    try{ await navigator.clipboard.writeText(txt || 'Nothing left to buy!'); toast('Copied your list'); }catch(err){ toast("Couldn't copy on this device"); }
    return;
  }
  if(a === 'resetshop'){
    const need = visibleItems().filter(i => !shop[i.id]).length;
    $('#modalRoot').innerHTML = `<div class="modal" data-act="mclose"><div class="card" data-stop><h3>Finish this trip?</h3><div class="muted">Your cart goes to Past trips.${need ? ' Anything left stays on your list.' : ''}</div>${need ? `<label class="clearopt"><input type="checkbox" id="clearRest"><span>Clear ${need} remaining item${need === 1 ? '' : 's'}?</span></label>` : ''}<div class="row"><button class="btn" data-act="mclose">Cancel</button><button class="btn primary" data-act="finishok">Finish trip</button></div></div></div>`;
    return;
  }
  if(a === 'ing'){ const c = cookOf(id), key = el.dataset.k, v = !c.i[key]; mutate(k => { const o = k.progress.cook[id] = k.progress.cook[id] || {}; (o.i = o.i || {})[key] = v; }); return; }
  if(a === 'step'){ const c = cookOf(id), key = el.dataset.k, v = !c.s[key]; mutate(k => { const o = k.progress.cook[id] = k.progress.cook[id] || {}; (o.s = o.s || {})[key] = v; delete o.before; syncMade(k, id); }); return; }
  if(a === 'resetrecipe'){ confirmBox('Reset progress?', 'Unchecks every ingredient and step.', 'Reset', () => mutate(k => { bankLegacy(k, id); k.progress.cook[id] = {i:{}, s:{}}; })); return; }
  if(a === 'finishok'){ const c = !!($('#clearRest') || {}).checked; $('#modalRoot').innerHTML = ''; newTrip(c); return; }
  if(a === 'fav'){ e.stopPropagation(); const v = !favOf(id); mutate(k => { const f = k.progress.fav = k.progress.fav || {}; if(v) f[id] = true; else delete f[id]; }); return; }
  if(a === 'catmenu'){ catOpen = !catOpen; sortOpen = false; render(); return; }
  if(a === 'catclear'){ e.stopPropagation(); recTags = []; catOpen = false; render(); return; }
  if(a === 'catpick'){ const t = el.dataset.t; recTags = recTags.includes(t) ? recTags.filter(x => x !== t) : recTags.concat(t); render(); return; }
  if(a === 'favfilter'){ recFav = !recFav; render(); return; }
  if(a === 'sortmenu'){ sortOpen = !sortOpen; catOpen = false; render(); return; }
  if(a === 'sortpick'){ ui.rsort = el.dataset.k; saveUi(); sortOpen = false; render(); return; }
  if(a === 'tagedit'){ tagEdit = id; render(); return; }
  if(a === 'tagdel'){ const t = el.dataset.t, n = recipes.filter(r => tagsOf(r).includes(t)).length;
    confirmBox(`Delete the “${t}” tag?`, n ? `It comes off ${n} recipe${n === 1 ? '' : 's'}. The recipes stay.` : 'It isn’t on any recipes.', 'Delete tag', () => mutate(k => { k.progress.ctags = (k.progress.ctags || []).filter(x => x !== t); const tg = k.progress.tags = k.progress.tags || {}; recipes.forEach(r => { const cur = tg[r.id] || autoTags(D(r)); if(cur.includes(t)) tg[r.id] = cur.filter(x => x !== t); }); recTags = recTags.filter(x => x !== t); })); return; }
  if(a === 'tagdone'){ tagEdit = null; render(); return; }
  if(a === 'tagtog'){ const r = R(id); if(!r) return; const t = el.dataset.t, cur = tagsOf(r), nx = cur.includes(t) ? cur.filter(x => x !== t) : cur.concat(t); mutate(k => { (k.progress.tags = k.progress.tags || {})[id] = nx; }); return; }
  if(a === 'sclear'){ shopQ = ''; const qi = $('#shopq'); if(qi) qi.value = ''; render(); const q = $('#shopq'); if(q) q.focus({preventScroll:true}); return; }
  if(a === 'more'){ moreOpen = !moreOpen; render(); return; }
  if(a === 'addask'){ addSheet = {id}; render(); return; }
  if(a === 'sheetclose'){ addSheet = null; render(); return; }
  if(a === 'addall'){ const r = R(id); if(!r) return; const lines = ingLines(D(r)); addSheet = null; mutate(k => addFresh(k, id, lines)); toast(`Added ${lines.length} ingredients to your list`); return; }
  if(a === 'choose'){ addSheet = null; choosing = id; chosenN = 0; mutate(k => unlinkRecipe(k, id)); setTimeout(() => { const c = $('.ing-col'); if(c) window.scrollTo({top: c.getBoundingClientRect().top + scrollY - 130, behavior: 'smooth'}); }, 30); return; }
  if(a === 'choosedone'){ choosing = null; render(); if(chosenN) toast(`${chosenN} added to your list`); return; }
  if(a === 'ingadd'){ const r = R(id); if(!r) return; const [gi, ki] = el.dataset.k.split('-').map(Number); const line = ((D(r).ingredients || [])[gi] || {}).items[ki]; if(!line) return;
    if(ingListed(id, line)){ chosenN = Math.max(0, chosenN - 1); const key = splitIngredient(line).key; mutate(k => unlinkRecipe(k, id, new Set([key]))); return; }
    chosenN++; mutate(k => addFresh(k, id, [line])); return; }
  if(a === 'markall'){ const r = R(id); if(!r) return; const prev = JSON.parse(JSON.stringify(cookOf(id).s)); const keys = stepList(D(r)).map(x => x.key);
    mutate(k => { const o = k.progress.cook[id] = k.progress.cook[id] || {}; o.s = o.s || {}; o.before = Object.assign({}, prev); keys.forEach(x => { o.s[x] = true; }); syncMade(k, id); });
    toast('Marked complete'); return; }
  if(a === 'unmark'){ mutate(k => { const o = k.progress.cook[id] = k.progress.cook[id] || {}; if(!o.before) return; o.s = Object.assign({}, o.before); delete o.before; syncMade(k, id); }); toast('Back to where you were'); return; }
  if(a === 'again'){ mutate(k => { bankLegacy(k, id); k.progress.cook[id] = {i:{}, s:{}}; }); addSheet = {id, again: true}; render(); window.scrollTo({top: 0, behavior: 'smooth'}); return; }
  if(a === 'recipex'){ const r = R(id); if(!r) return;
    $('#modalRoot').innerHTML = `<div class="modal" data-act="mclose"><div class="card" data-stop><h3>${esc(D(r).title)}</h3><div class="muted">Archive hides it until you want it again. Delete removes it for good.</div><div class="row"><button class="btn" data-act="mclose">Cancel</button><button class="btn" data-act="archive" data-id="${esc(id)}">Archive</button><button class="btn dangerbtn" data-act="delrecipe" data-id="${esc(id)}">Delete</button></div></div></div>`;
    return; }
  if(a === 'archive'){ $('#modalRoot').innerHTML = ''; const r = R(id); mutate(k => { (k.progress.archived = k.progress.archived || {})[id] = true; }); toast(D(r).title + ' archived'); if(location.hash !== '#recipes') location.hash = 'recipes'; return; }
  if(a === 'unarch'){ const r = R(id); mutate(k => { if(k.progress.archived) delete k.progress.archived[id]; }); toast(D(r).title + ' is back'); return; }
  if(a === 'delrecipe'){ const r = R(id); confirmBox('Delete this recipe?', 'Deletes ' + D(r).title + ', its photo, progress and list items only it needed. Can\'t be undone.', 'Delete recipe', () => deleteRecipe(id)); return; }
  if(a === 'starters'){ el.disabled = true; addStarters(); return; }
  if(a === 'parse'){ fillFromPaste(); return; }
  if(a === 'addopen'){ ui.addOpen = true; render(); setTimeout(() => { const n = $('#addName'); if(n) n.focus(); }, 30); return; }
  if(a === 'addclose'){ ui.addOpen = false; render(); return; }
  if(a === 'aisles'){ drawAisles(); return; }
  if(a === 'secmv'){
    const s = el.dataset.s, d = +el.dataset.d, vis = [...document.querySelectorAll('.section[data-sec]')].map(x => x.dataset.sec), nb = vis[vis.indexOf(s) + d];
    if(!nb) return;
    const o = aisleOrder().filter(x => x !== s); o.splice(o.indexOf(nb) + (d > 0 ? 1 : 0), 0, s);
    mutate(k => { k.shopping.sections = o.slice(); });
    setTimeout(() => { const n = document.querySelector(`.section[data-sec="${CSS.escape(s)}"]`); if(n){ n.classList.add('moved'); n.scrollIntoView({block:'nearest', behavior:'smooth'}); setTimeout(() => n.classList.remove('moved'), 700); } }, 20);
    return;
  }
  if(a === 'aislemove'){ const o = aisleOrder(), i = +el.dataset.i, j = i + (+el.dataset.d); if(j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; mutate(k => { k.shopping.sections = o.slice(); }); drawAisles(j); return; }
  if(a === 'import'){ importLink(); return; }
  if(a === 'rmphoto'){ if(form.photoUrl) URL.revokeObjectURL(form.photoUrl); form.photoBlob = null; form.photoUrl = null; form.removePhoto = true; render(); return; }
  if(a === 'saveform'){ saveForm(id || null); return; }
  if(a === 'timer'){ startTimer(+el.dataset.min, el.dataset.label); return; }
  if(a === 'untimer'){ timers = timers.filter(t => t.id !== id); drawTimers(); return; }
  if(a === 'jump'){ const s = document.getElementById('s-' + el.dataset.k); if(s) s.scrollIntoView({behavior:'smooth', block:'center'}); return; }
  if(a === 'mclose'){ if(e.target.closest('[data-stop]') && el.classList.contains('modal')) return; $('#modalRoot').innerHTML = ''; return; }
  if(a === 'mok'){ $('#modalRoot').innerHTML = ''; const fn = confirmFn; confirmFn = null; if(fn) fn(); return; }
  if(a === 'signout'){ await flush(); try{ sessionStorage.removeItem('mb-in'); }catch(err){} gate = 'gate'; await sb.auth.signOut(); location.hash = ''; return; }
  if(a === 'enter'){ enterKitchen(); return; }
  if(a === 'wake'){
    if(wakeLock){ wantWake = false; try{ await wakeLock.release(); }catch(err){} wakeLock = null; render(); return; }
    wantWake = true;
    try{ wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; render(); }); toast('Screen will stay on'); render(); }
    catch(err){ wantWake = false; toast("Not supported on this browser"); }
  }
});
document.addEventListener('input', e => {
  if(e.target.id === 'shopq'){ shopQ = e.target.value; render(); return; }
  if(e.target.id === 'f-steps') stepPreview();
  if(e.target.id === 'fsearch'){ const q = e.target.value.trim().toLowerCase(); let n = 0; document.querySelectorAll('#fgrid .tile').forEach(t => { const m = !q || t.dataset.q.includes(q); t.hidden = !m; if(m) n++; }); const no = $('#fnone'); if(no) no.hidden = !!n; return; }
  if(e.target.id === 'f-paste'){ const b = $('#f-parsebtn'); if(b) b.disabled = !e.target.value.trim(); }
  if(e.target.id === 'rsearch'){
    recQ = e.target.value; const q = e.target.value.trim().toLowerCase(); let n = 0;
    document.querySelectorAll('#rgrid .tile[data-q]').forEach(t => { const m = !q || t.dataset.q.includes(q); t.hidden = !m; if(m) n++; });
    const add = $('#rgrid .addtile'); if(add) add.hidden = !!q;
    let an = 0; document.querySelectorAll('#archbox .arow').forEach(t => { const m = !q || t.dataset.q.includes(q); t.hidden = !m; if(m) an++; });
    const ab = $('#archbox'); if(ab){ ab.hidden = !!q && !an; if(q && an) ab.open = true; }
    const none = $('#rnone'); if(none) none.hidden = !q || n + an > 0;
  }
  if(e.target.id === 'f-title'){ const p = $('#f-pic'); if(p && !p.querySelector('img')) p.innerHTML = art(guessArt(e.target.value), e.target.value); }
});
function autoImport(el){
  const u = el.value.trim();
  if(form && form.forId === 'new' && /^https?:\/\/\S+\.\S+/i.test(u) && u !== form.lastImport){ form.lastImport = u; importLink(); }
}
document.addEventListener('keydown', e => { if(e.key === 'Enter' && e.target.id === 'f-link'){ e.preventDefault(); autoImport(e.target); } });
document.addEventListener('focusout', e => { if(e.target.id === 'f-link') autoImport(e.target); });
document.addEventListener('paste', e => {
  if(e.target.id === 'f-link' && form && form.forId === 'new') setTimeout(() => autoImport(e.target), 0);
});
document.addEventListener('change', async e => {
  if(e.target.dataset && e.target.dataset.photoFor && e.target.files[0]){
    const id = e.target.dataset.photoFor, row = R(id); if(!row) return;
    photoBusy = id; render();
    try{
      const blob = await shrink(e.target.files[0], 1400);
      const up = await uploadPhoto(id, blob);
      const old = row.data.photoPath;
      const data = Object.assign({}, row.data, {photo: up.url, photoPath: up.path});
      const {error} = await sb.from('recipes').update({data}).eq('id', id); if(error) throw error;
      row.data = data; if(old) sb.storage.from('photos').remove([old]).catch(() => {});
      toast('Photo saved');
    }catch(err){ console.error(err); toast("Couldn't upload. Try another photo."); }
    photoBusy = null; render(); return;
  }
  if(e.target.id === 'f-photo' && e.target.files[0]){
    const blob = await shrink(e.target.files[0], 1400);
    if(form.photoUrl) URL.revokeObjectURL(form.photoUrl);
    form.photoBlob = blob; form.photoUrl = URL.createObjectURL(blob); form.removePhoto = false; e.target.value = ''; render();
  }
});
document.addEventListener('submit', async e => {
  const kind = e.target.dataset.form; if(!kind) return; e.preventDefault();
  if(['signin','signup','forgot','newpass'].includes(kind)){ return handleAuthForm(kind); }
  if(kind === 'frsend'){ const em = (($('#fr-email') || {}).value || '').trim(); if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){ toast('Enter their email address'); return; }
    const btn = e.target.querySelector('button'); btn.disabled = true;
    const {error} = await sb.rpc('send_friend_request', {target_email: em});
    btn.disabled = false; if(error){ toast(/slow down/.test(error.message || '') ? "That's a lot of requests today. Try again tomorrow." : "Couldn't send it. Try again."); return; }
    addFriendOpen = false; const ei = $('#fr-email'); if(ei) ei.value = ''; toast('Request sent'); loadFriends(true); return; }
  if(kind === 'newtag'){
    const id = e.target.dataset.id, r = R(id), raw = ($('#newtag').value || '').replace(/\s+/g, ' ').trim(); if(!r || !raw) return;
    const t = raw.charAt(0).toUpperCase() + raw.slice(1), ex = allTags().find(x => x.toLowerCase() === t.toLowerCase()) || t;
    const cur = tagsOf(r);
    mutate(k => { const c = k.progress.ctags = k.progress.ctags || []; if(!TAGS0.includes(ex) && !c.includes(ex)) c.push(ex); if(!cur.includes(ex)) (k.progress.tags = k.progress.tags || {})[id] = cur.concat(ex); });
    $('#newtag').value = ''; return;
  }
  if(kind === 'additem'){
    const name = $('#addName').value.trim(); if(!name) return;
    const qty = $('#addQty').value.trim(), section = $('#addSec').value || 'Other', forId = ($('#addFor') || {}).value || '';
    const id = 'c-' + Date.now().toString(36) + rid().slice(0, 4);
    mutate(k => { if(!k.shopping.items.some(i => i.id === id)) k.shopping.items.push({id, name, qty, section, key: splitIngredient(name).key, recipes: forId ? [forId] : [], custom:true}); if(forId) k.progress.active[forId] = true; });
    ui.sec = section; saveUi(); $('#addName').value = ''; $('#addQty').value = '';
    if(ui.filter === 'cart' || ui.filter === 'have'){ ui.filter = 'all'; saveUi(); }
    render(); toast('Added ' + name); const n = $('#addName'); if(n) n.focus({preventScroll:true});
  }
  if(kind === 'password'){
    const cur = $('#pw-cur').value, nw = $('#pw-new').value, nw2 = $('#pw-new2').value;
    if(nw !== nw2){ toast("The new passwords don't match"); return; }
    if(nw.length < 6){ toast('Use at least 6 characters'); return; }
    const check = await sb.auth.signInWithPassword({email: user.email, password: cur});
    if(check.error){ toast('Your current password is incorrect'); return; }
    const {error} = await sb.auth.updateUser({password: nw});
    if(error) toast("Couldn't update: " + error.message); else { ['#pw-cur','#pw-new','#pw-new2'].forEach(s => { const f = $(s); if(f) f.value = ''; }); toast('Password updated'); }
    return;
  }
  if(kind === 'name'){
    const name = $('#acc-name').value.trim();
    const {data, error} = await sb.auth.updateUser({data:{name}});
    if(error) toast("Couldn't save your name"); else { user = data.user; toast('Saved'); render(); }
  }
});
window.addEventListener('hashchange', () => { addSheet = null; addFriendOpen = false; sendSheet = null; fQ = ''; fCatOpen = false; fSortOpen = false; if(!/^#fr?-/.test(location.hash)) fCat = []; if(/^#(friends|f-)/.test(location.hash)) loadFriends(); choosing = null; moreOpen = false; shopQ = ''; catOpen = false; sortOpen = false; tagEdit = null; render(); });

boot();

// --- recipe page: back to top ---
let toTop = null;
function onNavScroll(){
  const tb = document.getElementById('timers'); document.documentElement.style.setProperty('--navlift', (tb && tb.children.length ? tb.offsetHeight : 0) + 'px');
  if(!toTop){ toTop = document.createElement('button'); toTop.className = 'totop'; toTop.type = 'button'; toTop.setAttribute('aria-label', 'Back to top'); toTop.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>'; toTop.addEventListener('click', () => window.scrollTo({top: 0, behavior: 'smooth'})); document.body.appendChild(toTop); }
  toTop.classList.toggle('show', route().v === 'recipe' && window.scrollY > innerHeight * 1.5);
}
window.addEventListener('scroll', onNavScroll, {passive: true});
window.addEventListener('resize', onNavScroll);

async function acceptInvite(){
  const t = inviteToken(); if(!t) return;
  const {data, error} = await sb.rpc('accept_invite_link', {t});
  forgetInvite(); inviteInfo = null;
  if(error){ toast("Couldn't accept the invite. Ask for a new link."); render(); return; }
  if(data) toast(`You and ${data} are now friends`); else toast("That's your own invite link");
  await loadFriends(true);
}
function afterInviteLogin(){
  if(!inviteToken()) return;
  rememberInvite(inviteToken()); if(location.hash !== '#friends') location.hash = 'friends'; else render();
}
window.addEventListener('focus', () => { if(user && loaded) loadFriends(); });
