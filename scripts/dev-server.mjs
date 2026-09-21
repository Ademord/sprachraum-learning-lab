import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import worker from '../server/worker.js';
import { localDB } from './local-db.mjs';
fs.mkdirSync('.local', { recursive: true });
const DB = localDB('.local/sessions.sqlite');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const ASSETS = { fetch: async request => {
  const url = new URL(request.url), pathname = decodeURIComponent(url.pathname);
  const file = path.resolve('dist', '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(path.resolve('dist') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile() || /[\\/](server|client|\.openai)[\\/]/.test(file)) return new Response('Not found', { status: 404 });
  return new Response(fs.readFileSync(file), { headers: { 'Content-Type': mime[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-store' } });
} };
const server = http.createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, 'http://127.0.0.1:4186');
    const headers = new Headers(); for (const [key, value] of Object.entries(incoming.headers)) if (value && !key.startsWith('oai-authenticated-user-')) headers.set(key, String(value));
    // Local preview only; the deployed Worker never accepts this test identity.
    const user = /(?:^|;\s*)sprachraum-dev-role=(teacher|learner)/.exec(headers.get('cookie') || '')?.[1] || 'learner';
    headers.set('oai-authenticated-user-id', `local-${user}`);
    const request = new Request(url, { method: incoming.method, headers, ...(incoming.method !== 'GET' && incoming.method !== 'HEAD' ? { body: incoming, duplex: 'half' } : {}) });
    const response = await worker.fetch(request, { DB, ASSETS });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end('Local preview error'); }
});
server.listen(4186, '127.0.0.1', () => console.log('Sprachraum local preview: http://127.0.0.1:4186'));
