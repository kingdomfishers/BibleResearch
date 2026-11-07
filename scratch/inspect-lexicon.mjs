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

// Check existing lemma_root_links count and sample
const { count: linkCount, data: sampleLinks } = await supabase
  .from('lemma_root_links')
  .select('id,lemma_id,root_id,etymology_type,source_record_id', { count: 'exact' })
  .limit(5);

console.log('Existing lemma_root_links count:', linkCount);
console.log('Sample links:', sampleLinks);
