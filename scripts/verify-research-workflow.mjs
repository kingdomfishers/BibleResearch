import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WORKFLOW_INSTRUCTIONS, WORKFLOW_VERSION } from '../supabase/functions/bible-mcp/research-workflow.ts';
import { WORKFLOW_ROUTES, RESEARCH_PROFILES, RESEARCH_TOOL_NAMES } from '../supabase/functions/bible-mcp/workflow-contract.ts';
const read = p => fs.readFile(p, 'utf8');
const skill = await read('skills/bible-research/SKILL.md');
const front = skill.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
assert.ok(front, 'Skill requires YAML frontmatter');
const fields = Object.fromEntries(front[1].split(/\r?\n/).map(line => {
  const i = line.indexOf(':'); assert.ok(i > 0); return [line.slice(0, i), line.slice(i + 1).trim()];
}));
assert.deepEqual(Object.keys(fields).sort(), ['description', 'name']);
assert.match(fields.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
assert.ok(fields.name.length <= 64 && fields.description.length <= 1024 && !/[<>]/.test(fields.description));
assert.ok(!/^\s*\[TODO:/m.test(skill));
const contracts = await read('skills/bible-research/references/tool-contracts.md');
assert.equal(WORKFLOW_INSTRUCTIONS,
  skill.slice(front[0].length).trim().split('## Further contract details')[0].trim() + '\n\n' + contracts.trim());
assert.deepEqual(RESEARCH_PROFILES.analysis, { mode: 'sample', limit: 5 });
assert.deepEqual(RESEARCH_PROFILES.full, { mode: 'all' });
const fixtures = JSON.parse(await read('scripts/fixtures/research-workflow-cases.json'));
assert.ok(fixtures.cases.length >= 20);
assert.equal(new Set(fixtures.cases.map(c => c.id)).size, fixtures.cases.length);
for (const c of fixtures.cases) {
  assert.ok(c.request && c.checks.length >= 2);
  if (c.intent !== null) {
    assert.ok(WORKFLOW_ROUTES[c.intent], `Missing route for ${c.id}`);
    assert.ok(WORKFLOW_ROUTES[c.intent].starting_tools.every(t => RESEARCH_TOOL_NAMES.includes(t)));
  }
}
const output = '.artifacts/research-plugin/bible-research';
const files = ['plugin.json', 'mcp.json', 'gemini-extension.json', 'GEMINI.md',
  'skills/bible-research/SKILL.md', 'skills/bible-research/references/tool-contracts.md', 'skills/bible-research/agents/openai.yaml'];
async function walk(dir) {
  return (await Promise.all((await fs.readdir(dir, { withFileTypes: true })).map(async e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))).flat();
}
assert.deepEqual((await walk(output)).map(p => path.relative(output, p).replaceAll('\\', '/')).sort(), files.sort());
for (const file of files) {
  const source = file.startsWith('skills/') ? file : `integrations/${file}`;
  assert.equal(await read(`${output}/${file}`), await read(source), `Stale package: ${file}`);
}
const plugin = JSON.parse(await read(`${output}/plugin.json`));
const mcp = JSON.parse(await read(`${output}/mcp.json`));
const gemini = JSON.parse(await read(`${output}/gemini-extension.json`));
assert.equal(plugin.name, fields.name); assert.equal(plugin.version, WORKFLOW_VERSION);
assert.equal(gemini.name, plugin.name); assert.equal(gemini.version, plugin.version);
assert.equal(mcp.mcpServers.bibleresearch.type, 'streamable-http');
assert.equal(gemini.mcpServers.bibleresearch.httpUrl, mcp.mcpServers.bibleresearch.url);
assert.deepEqual(Object.keys(mcp.mcpServers.bibleresearch).sort(), ['type', 'url'], 'Public connection must not contain credentials or auth headers');
assert.equal(gemini.contextFileName, 'GEMINI.md');
assert.ok((await read(`${output}/skills/bible-research/agents/openai.yaml`)).includes(mcp.mcpServers.bibleresearch.url));
console.log(`PASS shared skill, generated workflow parity, public-only OpenAI/Gemini packages and ${fixtures.cases.length} behavioral evaluation rubrics (provider responses not evaluated)`);
