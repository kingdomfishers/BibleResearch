// Advisory navigation review: no mandatory manifests, TOC synchronization or splitting.
import fs from 'node:fs';
import path from 'node:path';

const walk = (entry) => fs.statSync(entry).isDirectory()
  ? fs.readdirSync(entry).flatMap(name => walk(path.join(entry, name)))
  : [entry];
const roots = process.argv.slice(2);
const files = [...new Set((roots.length ? roots : ['src']).flatMap(walk))]
  .filter(file => /\.(ts|tsx)$/.test(file) && !file.endsWith('.test.ts'));
let notices = 0;
const advise = (file, message) => {
  console.log('REVIEW:', file, message);
  notices++;
};
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  if (lines.length > 800) advise(file, lines.length + ' lines; consider cohesion before splitting.');
  const sections = lines.flatMap((line, index) => {
    const match = line.match(/^\s*[/][/] === @section:(.+?) ===\s*$/);
    return match ? [{ name: match[1], index }] : [];
  });
  const seen = new Set();
  sections.forEach((section, index) => {
    if (seen.has(section.name)) advise(file, 'Duplicate navigation anchor: ' + section.name);
    seen.add(section.name);
    const length = (sections[index + 1]?.index ?? lines.length) - section.index;
    if (length > 150) advise(file, '@section:' + section.name + ' spans ' + length + ' lines; review readability.');
  });
}
console.log('Reviewed ' + files.length + ' files; ' + notices + ' advisory notices (no hard size/metadata gates).');
