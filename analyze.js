// analyze.js — motor de pontuação SEM base de fontes.
// A nota parte de um ponto neutro e depende só de sinais observáveis da página e do domínio.
import { baseDomain } from './extract.js';

const BASE = 55;
const BANDS = [
  [75, 'confiavel', 'Confiável'],
  [55, 'provavel', 'Provavelmente confiável'],
  [40, 'incerto', 'Incerto'],
  [25, 'suspeito', 'Suspeito'],
  [0, 'muito_suspeito', 'Muito suspeito'],
];

const TLD_ALTO = ['.xyz', '.top', '.click', '.online', '.site', '.info', '.biz', '.club', '.icu', '.live', '.news'];
const TLD_INST = ['.gov.br', '.edu.br', '.jus.br', '.leg.br', '.mp.br', '.gov', '.edu'];

// Plataformas abertas: o domínio não diz nada sobre quem escreveu
const PLATAFORMAS = ['blogspot.com', 'blogspot.com.br', 'wordpress.com', 'medium.com', 'substack.com',
  'wixsite.com', 'github.io', 'netlify.app', 'vercel.app', 'pages.dev', 'tumblr.com', 'weebly.com',
  'blogger.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'youtube.com', 'tiktok.com',
  't.me', 'linkedin.com'];
const ehPlataforma = d => PLATAFORMAS.some(p => d === p || d.endsWith('.' + p));

const LEX_CFG = {
  sensacionalismo: { w: -3, min: 3, nome: 'sensacionalismo' },
  atribuicaoVaga:  { w: -3, min: 2, nome: 'atribuição vaga' },
  conspiracao:     { w: -4, min: 1, nome: 'conspiração' },
  absolutos:       { w: -2, min: 3, nome: 'afirmações absolutas' },
};

export function analyze(s, ageDays) {
  const ev = [];
  const add = (label, weight, detail = '') =>
    ev.push({ label, weight, detail, kind: weight > 0 ? 'pos' : weight < 0 ? 'neg' : 'neutral' });

  // Domínio
  if (s.domain && ehPlataforma(s.domain)) add('Conteúdo em plataforma aberta (autoria não verificada)', -6);
  if (s.domain && s.domain.split('.').some(p => p.startsWith('xn--'))) add('Domínio com punycode (xn--)', -10);

  const tld = s.domain ? '.' + s.domain.split('.').pop() : '';
  if (s.domain && TLD_INST.some(x => s.domain.endsWith(x))) add('TLD institucional', 8, tld);
  else if (TLD_ALTO.includes(tld)) add(`TLD de registro em massa (${tld})`, -7);

  if (ageDays != null) {
    if (ageDays < 365) add(`Domínio criado há ${ageDays} dias`, -9);
    else if (ageDays < 1095) add(`Domínio com ${(ageDays / 365).toFixed(1)} anos`, 0);
    else add(`Domínio antigo (${(ageDays / 365).toFixed(1)} anos)`, 8);
  }

  if (s.url && !/^https:/i.test(s.url)) add('Página sem HTTPS', -8);

  // Matéria — só penaliza ausência quando os metadados foram de fato lidos
  if (s.author) add(`Autoria declarada: ${s.author}`, 8);
  else if (s.metaOk) add('Sem assinatura de autor', -5);
  else add('Autoria não verificada (metadados indisponíveis)', 0);

  if (s.date) add('Data de publicação presente', 6);
  else if (s.metaOk) add('Sem data de publicação', -5);

  if (s.canonical) {
    try {
      const c = new URL(s.canonical).hostname.replace(/^www\./, '');
      if (s.domain && baseDomain(c) !== baseDomain(s.domain)) add('Canonical aponta para outro domínio', -4, c);
    } catch {}
  }

  if (s.chars < 1200) add(`Corpo curto (${s.chars} caracteres de texto)`, -5);
  else if (s.chars >= 2500) add('Matéria desenvolvida (texto longo)', 3);

  // Links externos: sinal fraco (qualquer site pode linkar qualquer coisa), mas matéria sem nenhuma referência é pior
  const externos = s.hosts.filter(h => !ehPlataforma(h));
  if (externos.length >= 3) add(`${externos.length} links para sites externos`, 5, externos.slice(0, 5).join(', '));
  else if (externos.length >= 1) add(`${externos.length} link(s) para sites externos`, 2, externos.join(', '));
  else if (s.chars >= 1200) add('Nenhum link para fonte externa', -4);

  // Linguagem
  if (s.capsRatio > 0.45 && s.title.length > 25) add('Manchete com excesso de maiúsculas', -4);
  if (s.excl >= 2) add(`${s.excl} exclamações na manchete`, -3);

  for (const [k, { w, min, nome }] of Object.entries(LEX_CFG)) {
    const h = s.hits[k];
    if (!h) continue;
    const todos = [...new Set([...h.title, ...h.body])];
    if (h.title.length >= 1 || h.body.length >= min) {
      add(`Marcadores de ${nome}: ${todos.slice(0, 5).join(', ')}`, w * Math.min(3, todos.length),
        h.title.length ? 'presente na manchete' : '');
    }
  }

  const score = Math.max(0, Math.min(100, ev.reduce((a, e) => a + e.weight, BASE)));
  const [, band, label] = BANDS.find(([min]) => score >= min);

  // Confiança = quantos sinais foram realmente avaliados
  const avaliados = [s.metaOk, ageDays != null, s.chars >= 1200].filter(Boolean).length;
  const confianca = avaliados >= 3 ? 'alta' : avaliados >= 2 ? 'média' : 'baixa';

  const jovem = ageDays != null && ageDays < 1095;
  const checklist = [
    !s.author && 'Procure o nome do autor e o histórico dele.',
    !s.date && 'Localize a data original da publicação.',
    (!s.author || jovem || externos.length === 0) && 'Abra a página "quem somos" e o CNPJ do veículo.',
    'Busque o trecho mais específico entre aspas no Google.',
    'Faça busca reversa da imagem principal.',
    'Procure release oficial (gov.br, órgão, empresa) sobre o fato.',
  ].filter(Boolean);

  return { score, band, label, ev, checklist, confianca };
}

// RDAP precisa do domínio registrável (m.folha.uol.com.br não existe no RDAP).
export async function domainAge(host) {
  const base = baseDomain(host);
  const endpoint = base.endsWith('.br') ? 'https://rdap.registro.br/domain/' : 'https://rdap.org/domain/';
  try {
    const r = await fetch(endpoint + base, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const j = await r.json();
    const reg = (j.events || []).find(e => e.eventAction === 'registration');
    if (!reg?.eventDate) return null;
    return Math.floor((Date.now() - new Date(reg.eventDate)) / 864e5);
  } catch { return null; }
}
