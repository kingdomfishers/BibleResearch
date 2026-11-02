// Validate distributable manifests against the schemas linked by OpenAI's packaging docs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { default: Ajv2020 } = await import(process.env.AJV_MODULE ||
  new URL('../.artifacts/openapi-validation/node_modules/ajv/dist/2020.js', import.meta.url).href);
const ajv = new Ajv2020({ strict: false, validateFormats: false, loadSchema: async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  assert.ok(response.ok, `Schema download failed: ${url}`); return response.json();
} });
for (const file of ['plugin.json', 'mcp.json']) {
  const manifest = JSON.parse(await fs.readFile(`integrations/${file}`, 'utf8'));
  const response = await fetch(manifest.$schema, { signal: AbortSignal.timeout(15000) });
  assert.ok(response.ok, `Could not retrieve ${manifest.$schema}`);
  const schema = await response.json();
  const validate = await ajv.compileAsync(schema);
  assert.ok(validate(manifest), `${file}: ${JSON.stringify(validate.errors)}`);
  console.log(`PASS official portable manifest schema: ${file}`);
}
