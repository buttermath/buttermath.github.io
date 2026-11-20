// A stand-in for the Butter Math database (Supabase), so the app can be tested without real accounts.
// It keeps one signed-in test member in memory. window.__seed (recipes) and window.__seedK (a saved list) start it with data;
// window.__offline = true makes every save fail, like a lost connection.
// In-memory stand-in for Supabase, enough for one signed-in member.
(function(){
  const db = window.__db = {recipes: (window.__seed||[]).map((d,i)=>({id:'00000000-0000-4000-9000-'+String(i+1).padStart(12,'0'), user_id:'u-test-1', sort:i+1, data:d})), kitchens: window.__seedK ? [window.__seedK] : [], error_log: []};
  const user = {id: 'u-test-1', email: 'tester@example.com', user_metadata: {name: 'Tester'}};
  const session = {user, access_token: 'x'};
  let uuid = 0; const newId = () => '00000000-0000-4000-8000-' + String(++uuid).padStart(12, '0');
  window.__calls = [];
  function q(table){
    const st = {table, op: 'select', filters: [], payload: null, single: false, maybe: false, order: null, wantRows: false};
    const run = () => { window.__calls.push(st.op + ' ' + table); if(window.__offline) return {data:null, error:{message:'Failed to fetch'}};
      let rows = db[table] || (db[table] = []);
      const match = r => st.filters.every(([c, v]) => r[c] === v);
      let data = null;
      if(st.op === 'select'){ data = rows.filter(match).map(r => JSON.parse(JSON.stringify(r))); if(st.order) data.sort((a, b) => (a[st.order] > b[st.order] ? 1 : -1)); }
      else if(st.op === 'insert'){ const arr = [].concat(st.payload).map(r => Object.assign({id: r.id || newId()}, JSON.parse(JSON.stringify(r)))); arr.forEach(r => { if(rows.some(x => x.id === r.id)) throw new Error('dup'); rows.push(r); }); data = arr; }
      else if(st.op === 'upsert'){ const arr = [].concat(st.payload); arr.forEach(r => { const k = table === 'kitchens' ? 'user_id' : 'id'; const i = rows.findIndex(x => x[k] === r[k]); if(i >= 0) rows[i] = Object.assign(rows[i], JSON.parse(JSON.stringify(r))); else rows.push(JSON.parse(JSON.stringify(r))); }); data = arr; }
      else if(st.op === 'update'){ rows.filter(match).forEach(r => Object.assign(r, JSON.parse(JSON.stringify(st.payload)))); data = rows.filter(match); }
      else if(st.op === 'delete'){ db[table] = rows.filter(r => !match(r)); data = []; }
      if(st.single || st.maybe) data = (data || [])[0] || null;
      return {data, error: null};
    };
    const b = {
      select(){ if(st.op === 'select') st.op = 'select'; return b; }, insert(p){ st.op = 'insert'; st.payload = p; return b; }, upsert(p){ st.op = 'upsert'; st.payload = p; return b; },
      update(p){ st.op = 'update'; st.payload = p; return b; }, delete(){ st.op = 'delete'; return b; },
      eq(c, v){ st.filters.push([c, v]); return b; }, in(){ return b; }, neq(){ return b; }, order(c){ st.order = c; return b; }, limit(){ return b; },
      single(){ st.single = true; return b; }, maybeSingle(){ st.maybe = true; return b; },
      then(res, rej){ return new Promise(r => setTimeout(r, 15)).then(run).then(res, rej); }
    };
    return b;
  }
  const RPC = {is_admin: false, my_friends: [], my_inbox: [], my_save_notices: []};
  window.__mockSupabase = {createClient(){ return {
    from: q,
    rpc(name){ window.__calls.push('rpc ' + name); return Promise.resolve({data: name in RPC ? RPC[name] : null, error: null}); },
    auth: { getSession: async () => ({data: {session}}), onAuthStateChange(){ return {data: {subscription: {unsubscribe(){}}}}; }, signOut: async () => ({}), updateUser: async () => ({data: {user}, error: null}) },
    channel(){ const c = {topic: 'x', on(){ return c; }, subscribe(){ return c; }}; return c; }, getChannels(){ return []; }, removeChannel(){},
    storage: {from(){ return {upload: async () => ({data: {}, error: null}), getPublicUrl: () => ({data: {publicUrl: ''}}), remove: async () => ({})}; }},
    functions: {invoke: async () => ({data: null, error: {message: 'offline test'}})}
  }; }};
})();
