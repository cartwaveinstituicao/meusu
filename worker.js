// worker.js — entrada do Cloudflare Worker.
// /api/read → função em functions/api/read.js; o resto são os arquivos do site (assets).
import { onRequestGet } from './functions/api/read.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/read') {
      if (request.method !== 'GET') return new Response('método não permitido', { status: 405 });
      return onRequestGet({ request, env, waitUntil: p => ctx.waitUntil(p) });
    }
    if (url.pathname.startsWith('/api/')) return new Response('não encontrado', { status: 404 });

    return env.ASSETS.fetch(request);
  },
};
