import fs from 'node:fs';
import path from 'node:path';

// Let's list local migration files
const localFiles = fs.readdirSync('supabase/migrations')
  .filter(f => f.endsWith('.sql'))
  .map(f => {
    const m = f.match(/^(\d+)/);
    return { file: f, version: m ? m[1] : null };
  });

console.log('Local migration count:', localFiles.length);
console.log('Last 8 local migrations:');
localFiles.slice(-8).forEach(f => console.log(' ', f.file));
