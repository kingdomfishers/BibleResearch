// AJV_MODULE may point to an installed Ajv 8 dist/2020.js module.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { default: Ajv2020 } = await import(process.env.AJV_MODULE ||
  new URL('../.artifacts/openapi-validation/node_modules/ajv/dist/2020.js', import.meta.url).href);
const spec = JSON.parse(await fs.readFile('supabase/openapi.json', 'utf8'));
const fixture = JSON.parse(await fs.readFile('scripts/fixtures/hydrated-research-cases.json', 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validate = name => ajv.compile({ components: spec.components, $ref: `#/components/schemas/${name}` });
const request = validate('VerseResearchRequest');
assert.equal(request({ passages: fixture.passages.slice(0, 2) }), true);
assert.equal(request({ passages: [fixture.passages[0]], occurrences: { mode: 'sample', limit: 2 } }), true);
for (const input of fixture.invalid) assert.equal(request(input), false, JSON.stringify(input));
assert.equal(request({ passages: [fixture.passages[0]], occurrences: { mode: 'all', limit: 2 } }), false);
const response = validate('VerseResearchPacket');
const packet = JSON.parse(await fs.readFile(process.argv[2] || '.artifacts/hydrated-ui/verse-research.json', 'utf8'));
assert.equal(response(packet), true, JSON.stringify(response.errors?.slice(0, 8)));
const error = validate('VerseResearchError');
assert.equal(error({ schema_version: 1, status: 'packet_limit_exceeded', measured_bytes: 9000000, max_packet_bytes: 8388608 }), true);
assert.equal(error({ schema_version: 1, status: 'invalid_request', message: 'Bad request' }), true);
console.log('PASS JSON Schema 2020-12: live full packet, nested fields, error responses and invalid request boundaries');
