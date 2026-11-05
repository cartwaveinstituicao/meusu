import { readPage } from './reader.js';
import { extract } from './extract.js';
import { analyze, domainAge } from './analyze.js';

const input = document.getElementById('url');
const go = document.getElementById('go');
const out = document.getElementById('out');

go.addEventListener('click', () => {
  const url = input.value.trim();
  if (!url) return erro('Cole uma URL.');
  rodar(url);
});
input.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });

function erro(msg) {
  out.hidden = false;
  out.innerHTML = `<p class="err">${esc(msg)}</p>`;
}

async function rodar(url) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url); } catch { return erro('URL inválida.'); }
  if (!/^https?:$/.test(u.protocol)) return erro('Use um link http ou https.');

  out.hidden = false;
  out.innerHTML = '<p class="load">Analisando…</p>';
  go.disabled = true;

  try {
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const [page, age] = await Promise.all([readPage(u.href), domainAge(host)]);

    const s = extract(page, u.href);
    s.url = u.href;
    render(s, analyze(s, age), age);
  } catch (err) {
    erro(err.message);
  } finally {
    go.disabled = false;
  }
}

function render(s, d, age) {
  out.innerHTML = `
    <div class="score ${d.band}" style="--s:${Number(d.score) || 0}">
      <strong>${d.score}</strong>
      <div><span class="lbl">${esc(d.label)}</span><small>confiança ${d.confianca}</small></div>
    </div>
    <h2>${esc(s.title)}</h2>
    ${age != null ? `<p class="dim">Domínio registrado há ${age} dias</p>` : ''}

    <h3>Evidências</h3>
    <ul class="ev">${d.ev.map(e =>
      `<li class="${e.kind}"><b>${e.weight > 0 ? '+' : ''}${e.weight}</b> ${esc(e.label)}${e.detail ? `<small>${esc(e.detail)}</small>` : ''}</li>`
    ).join('')}</ul>

    <h3>Checklist manual</h3>
    <ol class="chk">${d.checklist.map(i => `<li>${esc(i)}</li>`).join('')}</ol>

    <details><summary>Trecho extraído</summary><pre>${esc(s.body.slice(0, 300))}…</pre></details>`;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
