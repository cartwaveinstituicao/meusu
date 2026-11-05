// functions/api/read.js — Cloudflare Pages Function (rota GET /api/read?url=...)
// Guarda a chave do Jina (secret JINA_KEY), faz cache grátis com a Cache API
// e extrai metadados do HTML (JSON-LD, meta tags).
// O limite de uso por IP fica numa regra de Rate Limiting no painel da Cloudflare (sem código).

const TTL_CACHE = 86400; // 24h
const MAX_HTML = 1_500_000;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

function urlOk(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (u.username || u.password) return null;
  const h = u.hostname;
  if (!h.includes('.') || h.includes(':') || /^\d+(\.\d+){3}$/.test(h)) return null;
  if (/\.(local|internal|localhost)$/i.test(h)) return null;
  return u;
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i'));
  return m ? (m[1] ?? m[2]) : null;
};

const nome = a => {
  if (!a) return null;
  if (typeof a === 'string') return a;
  if (Array.isArray(a)) return a.map(nome).filter(Boolean).join(', ') || null;
  return a.name || null;
};

function artigoLd(html) {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      const pilha = Array.isArray(j) ? [...j] : [j];
      while (pilha.length) {
        const o = pilha.pop();
        if (!o || typeof o !== 'object') continue;
        if (Array.isArray(o['@graph'])) pilha.push(...o['@graph']);
        const t = [].concat(o['@type'] || []).join(' ');
        if (/Article|Report/.test(t)) return o;
      }
    } catch { /* JSON-LD quebrado: ignora */ }
  }
  return null;
}

function metaDoHtml(html) {
  const metas = {};
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const chave = (attr(m[0], 'name') || attr(m[0], 'property') || '').toLowerCase();
    const valor = attr(m[0], 'content');
    if (chave && valor && !(chave in metas)) metas[chave] = valor;
  }
  const ld = artigoLd(html);
  const autorMeta = [metas['author'], metas['article:author']].find(v => v && !/^https?:/i.test(v));
  const canonical = (html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i) || [''])[0];

  return {
    ok: true,
    title: metas['og:title'] || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || null,
    author: nome(ld?.author) || autorMeta || null,
    datePublished: ld?.datePublished || metas['article:published_time'] || null,
    dateModified: ld?.dateModified || metas['article:modified_time'] || null,
    siteName: metas['og:site_name'] || nome(ld?.publisher) || null,
    canonical: attr(canonical, 'href'),
    ldType: ld ? [].concat(ld['@type']).join(',') : null,
  };
}

async function pegaHtml(href) {
  try {
    const r = await fetch(href, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; VeritasBot/0.1)', accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok || !/html/i.test(r.headers.get('content-type') || '')) return null;
    return (await r.text()).slice(0, MAX_HTML);
  } catch { return null; }
}

async function pegaMarkdown(href, chave) {
  try {
    const headers = { 'X-Return-Format': 'markdown', Accept: 'text/plain' };
    if (chave) headers.Authorization = 'Bearer ' + chave; // sem chave, o Jina aplica um limite menor
    const r = await fetch('https://r.jina.ai/' + href, { headers, signal: AbortSignal.timeout(20000) });
    return { ok: r.ok, status: r.status, raw: r.ok ? await r.text() : '' };
  } catch { return { ok: false, status: 0, raw: '' }; }
}

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);

  // Só aceita chamadas feitas pelo próprio site (navegador manda Sec-Fetch-Site)
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return json({ error: 'origem não permitida' }, 403);
  const origem = request.headers.get('origin');
  if (origem && env.ALLOWED_ORIGIN && origem !== env.ALLOWED_ORIGIN) return json({ error: 'origem não permitida' }, 403);

  const alvo = urlOk(url.searchParams.get('url') || '');
  if (!alvo) return json({ error: 'URL inválida' }, 400);

  // Cache API: grátis e sem limite de escritas (em dev local ela não existe e é ignorada)
  const cache = globalThis.caches?.default;
  const chaveCache = new Request(url.origin + '/__cache?u=' + encodeURIComponent(alvo.href));
  if (cache) {
    const hit = await cache.match(chaveCache);
    if (hit) {
      const r = new Response(hit.body, hit);
      r.headers.set('x-cache', 'hit');
      return r;
    }
  }

  const [md, html] = await Promise.all([pegaMarkdown(alvo.href, env.JINA_KEY), pegaHtml(alvo.href)]);
  if (!md.ok) return json({ error: `Leitor indisponível (${md.status || 'timeout'})` }, 502);

  const corpo = JSON.stringify({ raw: md.raw, meta: html ? metaDoHtml(html) : { ok: false } });
  const resp = new Response(corpo, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${TTL_CACHE}`,
      'x-cache': 'miss',
    },
  });
  if (cache) waitUntil?.(cache.put(chaveCache, resp.clone()));
  return resp;
}
