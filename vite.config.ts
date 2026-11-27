import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');

const copyLiteraryPacksPlugin = {
  name: 'copy-literary-packs',
  closeBundle() {
    const src = path.join(rootDir, '.artifacts/v2/literary');
    const dst = path.join(rootDir, 'dist/v2/literary');
    if (fs.existsSync(src)) {
      fs.cpSync(src, dst, { recursive: true });
    }
  },
};

export default defineConfig({
  plugins: [copyLiteraryPacksPlugin],
  cacheDir: 'node_modules/.vite-r10',
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    port: 3000,
    watch: {
      ignored: [
        `${rootDir}/.artifacts/**`,
        `${rootDir}/.artifacts-r10/**`,
        `${rootDir}/.artifacts-r12/**`,
        `${rootDir}/.wrangler/**`,
        `${rootDir}/dist/**`,
        `${rootDir}/research/**`,
        `${rootDir}/data/**`,
        `${rootDir}/supabase/**`,
        `${rootDir}/third_party/**`,
        `${rootDir}/scratch/**`,
      ],
    },
  },
});
