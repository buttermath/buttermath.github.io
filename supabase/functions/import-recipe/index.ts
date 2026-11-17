// Mixing Bowl: fetch a recipe page and pull out the recipe (schema.org Recipe data).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
function clean(s: unknown): string {
  if (s == null) return '';
  let t = String(s);
  for (let i = 0; i < 2; i++) {
    t = t.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&([a-z]+\d*);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
  }
  return t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function decode(s: string): string {
  let t = s;
  for (let i = 0; i < 2; i++) {
    t = t.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&([a-z]+\d*);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
  }
  return t.replace(/\r/g, '').trim();
}
function dur(s: unknown): string {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/i.exec(String(s || ''));
  if (!m) return clean(s);
  let d = +(m[1] || 0), h = +(m[2] || 0), mi = +(m[3] || 0);
  h += d * 24; h += Math.floor(mi / 60); mi = mi % 60;
  const out = [];
  if (h) out.push(h + (h === 1 ? ' hr' : ' hrs'));
  if (mi) out.push(mi + ' min');
  return out.join(' ');
}
function isRecipe(o: any) {
  const t = o && o['@type'];
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
}
function findRecipe(o: any): any {
  if (!o || typeof o !== 'object') return null;
  if (Array.isArray(o)) { for (const x of o) { const r = findRecipe(x); if (r) return r; } return null; }
  if (isRecipe(o)) return o;
  for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    if (o[k]) { const r = findRecipe(o[k]); if (r) return r; }
  }
  return null;
}
function steps(ins: any): string[] {
  const lines: string[] = [];
  const walk = (x: any) => {
    if (!x) return;
    if (typeof x === 'string') { const c = clean(x); if (c) lines.push(c); return; }
    if (Array.isArray(x)) { x.forEach(walk); return; }
    const t = x['@type'];
    if (t === 'HowToSection' || (Array.isArray(t) && t.includes('HowToSection'))) {
      if (x.name) lines.push(clean(x.name).replace(/:?$/, ':'));
      walk(x.itemListElement);
      return;
    }
    if (x.text) { const c = clean(x.text); if (c) lines.push(c); }
    else if (x.name) { const c = clean(x.name); if (c) lines.push(c); }
    if (x.itemListElement) walk(x.itemListElement);
  };
  walk(ins);
  return lines;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { url, yt } = await req.json();
    if (!/^https?:\/\//i.test(url || '')) return json({ error: 'That doesn\'t look like a web link.' }, 400);
    const UAS = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Mozilla/5.0 (compatible; MixingBowl/1.0; +https://mixingbowl.github.io)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'curl/8.4.0',
    ];
    const isIG = /(^|\.)instagram\.com$/i.test(new URL(url).hostname);
    if (isIG) UAS.unshift(UAS.splice(2, 1)[0]); // Instagram answers link-preview bots with the caption
    // YouTube: return the video's full description (only when the app asks for it with yt: true)
    const host = new URL(url).hostname.replace(/^(www|m|music)\./i, '').toLowerCase();
    if (yt && (host === 'youtube.com' || host === 'youtu.be')) {
      const u = new URL(url);
      const id = host === 'youtu.be' ? u.pathname.slice(1).split('/')[0] : (u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/) || [])[1]);
      if (!id) return json({ error: 'That doesn\'t look like a YouTube video link.' }, 200);
      // YouTube blocks cloud servers from reading its pages, so this uses YouTube's official API.
      // The key is the YOUTUBE_API_KEY secret in Supabase (Edge Functions > Secrets).
      const key = Deno.env.get('YOUTUBE_API_KEY');
      if (!key) return json({ error: 'YouTube import isn\'t set up yet.', code: 'yt_setup' }, 200);
      const ar = await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet&id=' + encodeURIComponent(id) + '&key=' + encodeURIComponent(key));
      if (!ar.ok) return json({ error: 'YouTube wouldn\'t share that video (' + ar.status + ').' }, 200);
      const sn = (await ar.json())?.items?.[0]?.snippet;
      if (!sn) return json({ error: 'Couldn\'t find that YouTube video. It may be private.' }, 200);
      const desc = String(sn.description || ''), title = String(sn.title || '');
      if (desc.trim().length < 20) return json({ error: 'That video doesn\'t have a description to import.' }, 200);
      return json({ caption: desc, title, source: 'youtube' });
    }
    let res: Response | null = null;
    for (const ua of UAS) {
      res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': ua, 'Accept': 'text/html,application/xhtml+xml,*/*' } });
      if (res.ok) break;
      await res.body?.cancel();
    }
    if (!res) return json({ error: 'Couldn\'t load that link.' }, 200);
    if (!res.ok) return json({ error: 'The site wouldn\'t share that page (' + res.status + ').' }, 200);
    const html = (await res.text()).slice(0, 3_000_000);
    const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
    let m, rec: any = null;
    while ((m = re.exec(html)) && !rec) {
      try { rec = findRecipe(JSON.parse(m[1].trim())); } catch { /* skip bad block */ }
    }
    if (!rec) {
      const meta = (p: string) => {
        for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
          if (!new RegExp('(?:property|name)\\s*=\\s*["\']' + p + '["\']', 'i').test(tag)) continue;
          const c = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
          if (c) return decode(c[1] ?? c[2] ?? '');
        }
        return '';
      };
      let cap = meta('og:description') || meta('description');
      let full = false;
      if (isIG) {
        // The link-preview text cuts long captions short. The embed page carries the whole caption.
        try {
          const mm = /instagram\.com\/(?:[^\/]+\/)?(reels?|p|tv)\/([\w-]+)/i.exec(url);
          if (mm) {
            const er = await fetch('https://www.instagram.com/' + (mm[1] === 'reels' ? 'reel' : mm[1]) + '/' + mm[2] + '/embed/captioned/', { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept': 'text/html,*/*' } });
            if (er.ok) {
              const eh = await er.text();
              const a = eh.indexOf('class="Caption"');
              if (a >= 0) {
                let blk = eh.slice(a); blk = blk.slice(blk.indexOf('>') + 1);
                const e = blk.indexOf('<div class="CaptionComments');
                if (e >= 0) blk = blk.slice(0, e); else { const e2 = blk.indexOf('</div>'); if (e2 >= 0) blk = blk.slice(0, e2); }
                blk = blk.replace(/<a[^>]*CaptionUsername[^>]*>[\s\S]*?<\/a>/i, '').replace(/<br\s*\/?>/gi, '\n');
                const txt = decode(blk.replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
                if (txt.length > cap.length) { cap = txt; full = true; }
              }
            }
          }
        } catch { /* fall back to the short preview text */ }
      }
      // Instagram sometimes answers servers with its login page. That is not a caption.
      if (isIG && !full && /create an account or log in|log in to instagram|^instagram$/i.test(cap)) cap = '';
      if (isIG && cap) {
        // "2M likes, 2,748 comments - user on August 16, 2026: "caption"" -> caption
        const q = full ? null : cap.match(/^[\s\S]*?:\s*["\u201c]([\s\S]*)["\u201d]\.?\s*$/);
        if (q) cap = q[1];
        cap = cap.replace(/\s*#\w+/g, '').trim();
        if (cap.length > 40) return json({ caption: cap, source: 'instagram' });
        return json({ error: 'That post doesn\'t have a recipe in its caption.' }, 200);
      }
      if (isIG) return json({ error: 'Instagram wouldn\'t share that post. Copy the caption and paste it below.' }, 200);
      return json({ error: 'Couldn\'t find a recipe on that page.' }, 200);
    }
    const y = Array.isArray(rec.recipeYield) ? rec.recipeYield.map(clean).sort((a: string, b: string) => b.length - a.length)[0] : clean(rec.recipeYield);
    const ing = (rec.recipeIngredient || rec.ingredients || []);
    return json({
      title: clean(rec.name),
      yield: /^\d+$/.test(y || '') ? y + ' servings' : (y || ''),
      prep: dur(rec.prepTime), cook: dur(rec.cookTime), total: dur(rec.totalTime),
      ingredients: (Array.isArray(ing) ? ing : [ing]).map(clean).filter(Boolean).join('\n'),
      steps: steps(rec.recipeInstructions).join('\n'),
      notes: '',
    });
  } catch (e) {
    return json({ error: 'Couldn\'t load that link.' }, 200);
  }
});
