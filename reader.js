// reader.js — agora chama o proxy (Worker). Nenhuma chave no navegador.
export async function readPage(url) {
  const r = await fetch('/api/read?url=' + encodeURIComponent(url));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Leitor respondeu ${r.status}`);
  return j; // { raw, meta }
}
