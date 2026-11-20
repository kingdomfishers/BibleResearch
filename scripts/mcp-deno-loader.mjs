// Local-only helper: resolve Deno-cached npm packages (MCP SDK, zod) for Node tests.
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = process.env.DENO_NPM_CACHE || path.join(process.env.LOCALAPPDATA || '', 'deno', 'npm', 'registry.npmjs.org');
const pkgs = { '@modelcontextprotocol/server': '2.4.0', '@modelcontextprotocol/core': '2.4.0', zod: '4.6.7' };
function lookup(spec) {
  for (const name of Object.keys(pkgs)) {
    if (spec !== name && !spec.startsWith(name + '/')) continue;
    const dir = path.join(root, name, pkgs[name]);
    const sub = '.' + spec.slice(name.length);
    const pj = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    let t = pj.exports?.[sub];
    if (!t && sub.startsWith('./') && pj.exports) {
      for (const [k, v] of Object.entries(pj.exports)) if (k.endsWith('/*') && sub.startsWith(k.slice(0, -1))) { t = v; break; }
    }
    if (t) {
      const f = typeof t === 'string' ? t : (t.import?.default ?? t.import ?? t.default);
      const file = typeof f === 'string' ? f : f?.default;
      if (file) return pathToFileURL(path.join(dir, file)).href;
    }
    const alt = [path.join(dir, sub, 'index.js'), path.join(dir, sub + '.js')].find(existsSync);
    if (alt) return pathToFileURL(alt).href;
  }
  return null;
}
registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); } catch (e) {
      if (e?.code !== 'ERR_MODULE_NOT_FOUND' && e?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw e;
      const url = lookup(specifier);
      if (!url) throw e;
      return { url, shortCircuit: true };
    }
  },
});
