// Public-key-only verification client. Never exports or logs credential values.
import fs from 'node:fs/promises';
const config = Object.fromEntries((await fs.readFile('.env','utf8')).split(/\r?\n/)
  .filter(line => line.includes('=') && !line.trimStart().startsWith('#'))
  .map(line => { const at=line.indexOf('='); return [line.slice(0,at),line.slice(at+1).trim().replace(/^['"]|['"]$/g,'')]; }));
export const base = config.VITE_SUPABASE_URL;
const key = config.VITE_SUPABASE_ANON_KEY;
if (!base || !key) throw new Error('Missing public API configuration');
export const headers = {apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
export async function chronology(args) {
  const response = await fetch(`${base}/rest/v1/rpc/get_verse_chronology_v1`, {
    method:'POST',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Chronology HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}
