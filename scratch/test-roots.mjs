import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
    })
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const { count: rootCount } = await supabase.from('lexical_roots').select('*', { count: 'exact', head: true });
const { count: linkCount } = await supabase.from('lemma_root_links').select('*', { count: 'exact', head: true });
console.log({ rootCount, linkCount });
