import fs from 'node:fs';
import path from 'node:path';

const file = 'C:/Users/fluck/.gemini/antigravity/brain/f820b42b-04a2-4212-ac4e-b7ba25399c91/.system_generated/steps/39/output.txt';
const raw = fs.readFileSync(file, 'utf8');
const obj = JSON.parse(raw);
const match = obj.result.match(/\[\s*\{[\s\S]*\}\s*\]/);
const arr = JSON.parse(match[0]);

for (const m of arr) {
  const filename = `${m.version}_${m.name}.sql`;
  const targetPath = path.join('supabase', 'migrations', filename);
  // statements is array of strings
  let content = m.statements.join('\n');
  if (content.startsWith('\n')) {
    content = content.slice(1);
  }
  if (!content.endsWith('\n')) {
    content += '\n';
  }
  fs.writeFileSync(targetPath, content, 'utf8');
  console.log(`Wrote ${targetPath} (${content.length} bytes)`);
}
