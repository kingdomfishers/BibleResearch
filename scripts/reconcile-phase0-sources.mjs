// Reconcile captured provider sources without printing deployed code or datasets.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve('.artifacts/phase0');
const hash = value => crypto.createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');
const functions = JSON.parse(fs.readFileSync(path.join(root, 'live-functions.json'), 'utf8'));
const edge = JSON.parse(fs.readFileSync(path.join(root, 'live-bible-mcp.json'), 'utf8'));
const migrationPaths = fs.readdirSync('supabase/migrations').filter(n => n.endsWith('.sql'));
const localSql = migrationPaths.map(n => fs.readFileSync(path.join('supabase/migrations', n), 'utf8')).join('\n');
const missing = functions.filter(f => !new RegExp(`(?:function|procedure)\\s+(?:"?${f.schema}"?\\.)?"?${f.name}"?\\s*\\(`, 'i').test(localSql));
const deployedDir = path.join(root, 'deployed-mcp');
fs.mkdirSync(deployedDir, { recursive: true });
const edgeFiles = edge.files.map(file => {
  if (path.basename(file.name) !== file.name) throw Error('Unexpected provider source path');
  const local = path.join('supabase/functions/bible-mcp', file.name);
  const original = fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : null;
  fs.writeFileSync(path.join(deployedDir, file.name), file.content);
  return { name: file.name, deployed_sha256: hash(file.content), local_sha256: original === null ? null : hash(original), changed: original === null || hash(original) !== hash(file.content) };
});

if (process.argv.includes('--adopt-edge')) {
  // Never overwrite local edits. Provider source was captured before this operation.
  for (const file of edgeFiles.filter(f => f.changed)) {
    const target = `supabase/functions/bible-mcp/${file.name}`;
    const status = execFileSync('git', ['status', '--porcelain', '--', target], { encoding: 'utf8' }).trim();
    if (status) throw Error(`Local changes must be reconciled before adopting ${target}`);
  }
  for (const file of edgeFiles.filter(f => f.changed)) {
    fs.copyFileSync(path.join(deployedDir, file.name), `supabase/functions/bible-mcp/${file.name}`);
  }
}

const migrationFlag = process.argv.indexOf('--migration');
if (migrationFlag >= 0) {
  const target = process.argv[migrationFlag + 1];
  if (!target?.startsWith('supabase/migrations/')) throw Error('Expected generated migration path');
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8').trim()) throw Error('Refusing to overwrite an existing migration');
  if (!missing.length) throw Error('No missing definitions to reconcile');
  const statements = missing.map(f => {
    const signature = `${f.schema}.${f.name}(${f.identity_arguments})`;
    const grants = (f.acl ?? '{=X/postgres}').slice(1, -1).split(',').filter(Boolean).map(acl => {
      const [role, privileges] = acl.split('=');
      if (!privileges?.includes('X')) return '';
      if (role && !/^[a-z_]+$/.test(role)) throw Error('Unexpected ACL role');
      return `GRANT EXECUTE ON FUNCTION ${signature} TO ${role || 'PUBLIC'};`;
    }).filter(Boolean);
    return `-- Captured live SHA-256: ${hash(f.definition)}\n${f.definition.trim()};\nREVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated, service_role;\n${grants.join('\n')}`;
  });
  fs.writeFileSync(target, '-- Source reconciliation only: preserves deployed definitions and execution grants.\nBEGIN;\n' + statements.join('\n\n') + '\nCOMMIT;\n');
}

const report = { captured_functions: functions.length, deployed_edge_version: edge.version, missing_functions: missing.map(({schema,name,identity_arguments,definition}) => ({ schema, name, identity_arguments, sha256: hash(definition) })), edge_files: edgeFiles };
fs.writeFileSync(path.join(root, 'source-reconciliation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ functions: functions.length, missing: report.missing_functions.map(f => `${f.schema}.${f.name}`), edge_version: edge.version, changed_edge_files: edgeFiles.filter(f => f.changed).map(f => f.name) }));
