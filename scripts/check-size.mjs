import fs from 'node:fs';
import path from 'node:path';

const walk = (d) =>
  fs.readdirSync(d).flatMap((f) => {
    const q = path.join(d, f);
    return fs.statSync(q).isDirectory() ? walk(q) : q;
  });

let ok = true;
walk('src')
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'))
  .forEach((f) => {
    const txt = fs.readFileSync(f, 'utf8');
    const lines = txt.split(/\r?\n/);
    if (lines.length > 450) {
      console.error('FILE > 450 LINES:', f, lines.length);
      ok = false;
    }
    const tocLine = (lines.slice(0, 6).find((l) => l.startsWith('// @toc:')) || '')
      .replace('// @toc:', '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    const secs = [];
    txt
      .split('// === @section:')
      .slice(1)
      .forEach((s) => {
        const n = s.split(/\r?\n/).length;
        const name = s.split('===')[0].trim();
        secs.push(name);
        if (n > 80) {
          console.error('SECTION > 80 LINES:', f, '@section:' + name, n);
          ok = false;
        }
      });
    if (tocLine.join('|') !== secs.join('|')) {
      console.error(
        'TOC MISMATCH in',
        f,
        '\n  Header @toc:',
        tocLine.join(' | '),
        '\n  Actual @sections:',
        secs.join(' | ')
      );
      ok = false;
    }
  });

if (!ok) {
  process.exit(1);
} else {
  console.log('PASS: check:size verified successfully.');
}
