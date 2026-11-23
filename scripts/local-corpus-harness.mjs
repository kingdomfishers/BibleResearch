// Local harness: run the Cloudflare corpus worker against the staged asset bundle (no network).
import fs from 'node:fs';
import path from 'node:path';
import worker from './corpus-worker.mjs';
import { withCorpusSecurity } from './corpus-security.mjs';

const root = path.resolve(process.env.CORPUS_BUNDLE || '.artifacts-r12/staging-bundle');
const ASSETS = {
  async fetch(req) {
    const url = new URL(req.url);
    const file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('not found', { status: 404 });
    const buf = fs.readFileSync(file);
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.get('Range') || '');
    if (range) {
      const s = Number(range[1]), e = Number(range[2]);
      return new Response(buf.subarray(s, e + 1), { status: 206, headers: { 'Content-Range': `bytes ${s}-${e}/${buf.length}` } });
    }
    return new Response(buf, { status: 200 });
  },
};
const wrapped = withCorpusSecurity(worker);
export async function corpusRpc(name, params) {
  const res = await wrapped.fetch(new Request(`https://corpus.test/v1/rpc/${name}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params ?? {}),
  }), { ASSETS, WORKER_VERSION: { id: 'local' }, R12_RELEASE_ID: 'local' });
  if (!res.ok) throw new Error(`${name} -> ${res.status}`);
  return res.json();
}
// Drop-in fetcher for createApp(): routes corpus calls to the local worker, everything else is stubbed.
export function localCorpusFetcher(extra) {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input);
    if (url.pathname.startsWith('/v1/rpc/')) {
      const body = init?.body ? JSON.parse(init.body) : {};
      const res = await wrapped.fetch(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        { ASSETS, WORKER_VERSION: { id: 'local' }, R12_RELEASE_ID: 'local' });
      return res;
    }
    if (extra) { const r = await extra(url, init); if (r) return r; }
    return Response.json([]);
  };
}
