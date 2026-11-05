// extract.js — extrai sinais do texto e dos metadados.

const norm = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const escRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Termos escritos com acento por legibilidade; são normalizados ao compilar.
// "bomba" sozinha foi removida (aparece em notícia de guerra); "bomba!" é o uso chamativo.
const LEX = {
  sensacionalismo: ['urgente', 'bomba!', 'chocante', 'inacreditável', 'escândalo', 'revelado', 'exclusivo', 'compartilhe', 'surreal', 'caos', 'pânico', 'explode', 'detona', 'proibido', 'ninguém sabe', 'a verdade sobre', 'veja agora', 'você não vai acreditar', 'apague antes que'],
  atribuicaoVaga: ['segundo fontes', 'fontes afirmam', 'especialistas dizem', 'médicos afirmam', 'estudos apontam', 'dizem que', 'é sabido', 'cientistas descobrem'],
  conspiracao:    ['mídia não mostra', 'mídia esconde', 'ninguém fala sobre', 'globalistas', 'deep state', 'grande mídia', 'querem esconder', 'vão esconder'],
  absolutos:      ['100%', 'comprovado', 'definitivo', 'garantido', 'milagre', 'cura definitiva', 'sem nenhum risco'],
};

// Fronteira de palavra manual (\b não funciona com "100%" nem "bomba!")
const RX = Object.fromEntries(Object.entries(LEX).map(([k, lista]) => [
  k, lista.map(t => [t, new RegExp('(?<![a-z0-9])' + escRx(norm(t)) + '(?![a-z0-9])')]),
]));
const achar = (k, txt) => RX[k].filter(([, re]) => re.test(txt)).map(([t]) => t);

// Domínio registrável (aproximação sem a Public Suffix List)
const SLD = new Set(['com.br', 'org.br', 'gov.br', 'net.br', 'edu.br', 'jus.br', 'leg.br', 'mp.br',
  'co.uk', 'org.uk', 'com.au', 'co.jp', 'com.ar', 'com.mx', 'co.za']);
export function baseDomain(host) {
  const p = host.split('.');
  if (p.length <= 2) return host;
  const ult2 = p.slice(-2).join('.');
  return SLD.has(ult2) ? p.slice(-3).join('.') : ult2;
}

const hostDe = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };

export function extract(page, url) {
  const raw = page?.raw ?? '';
  const meta = page?.meta ?? null;

  const title = meta?.title || (raw.match(/^Title:\s*(.+)$/m) || [])[1] || '(sem título)';
  const author = meta?.author || (raw.match(/^(?:Author|By):\s*(.+)$/mi) || [])[1] || null;
  const date = meta?.datePublished || (raw.match(/^(?:Published Time|Published|Date):\s*(.+)$/mi) || [])[1] || null;
  const bodyRaw = raw.split('Markdown Content:')[1] || raw;
  const domain = hostDe(url);

  // Links externos (ignora o próprio site e domínios irmãos)
  const hosts = new Set();
  for (const m of bodyRaw.matchAll(/\]\((https?:\/\/[^)\s]+)/g)) {
    const h = hostDe(m[1]);
    if (h && (!domain || baseDomain(h) !== baseDomain(domain))) hosts.add(h);
  }

  // Só parágrafos de verdade: tira imagens, URLs dos links e linhas curtas (menus, rodapé)
  const limpo = bodyRaw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  const paragrafos = limpo.split('\n').map(l => l.trim()).filter(l => l.length >= 60).join('\n');

  // Trechos entre aspas não contam: matéria que CITA uma teoria da conspiração não é conspiratória
  const semAspas = paragrafos.replace(/"[^"]{3,300}"|“[^”]{3,300}”|«[^»]{3,300}»/g, ' ');
  const nTitulo = norm(title);
  const nCorpo = norm(semAspas);

  const hits = {};
  for (const k of Object.keys(LEX)) hits[k] = { title: achar(k, nTitulo), body: achar(k, nCorpo) };

  const letters = (title.match(/\p{L}/gu) || []).length;
  const upper = (title.match(/\p{Lu}/gu) || []).length;

  return {
    title, author, date, domain,
    modified: meta?.dateModified || null,
    canonical: meta?.canonical || null,
    metaOk: !!meta?.ok,
    body: paragrafos,
    hosts: [...hosts],
    chars: paragrafos.length,
    capsRatio: letters ? upper / letters : 0,
    excl: (title.match(/!/g) || []).length,
    hits,
  };
}
