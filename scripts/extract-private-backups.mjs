// scripts/extract-private-backups.mjs
// Extracts and saves:
// 1. 200 restricted frame records from public.macula_gated_field_values
// 2. 60 records from bible_internal.macula_syntax_unmapped_nodes
// 3. 983 records from bible_internal.macula_syntax_import_files
// into .artifacts/private-backup/ with AES-256-GCM encryption and plaintext SHA-256 verification.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const outDir = path.resolve('.artifacts/private-backup');
fs.mkdirSync(outDir, { recursive: true });

export function encryptAndSave(name, data, secretSalt) {
  const jsonPath = path.join(outDir, `${name}.json`);
  const plaintext = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
  fs.writeFileSync(jsonPath, plaintext);
  const sha256 = crypto.createHash('sha256').update(plaintext).digest('hex');

  const key = crypto.createHash('sha256').update(secretSalt).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const encPayload = {
    algorithm: 'aes-256-gcm',
    iv: iv.toString('hex'),
    auth_tag: authTag.toString('hex'),
    ciphertext: ciphertext.toString('base64'),
    plaintext_sha256: sha256,
    byte_length: plaintext.length,
    record_count: Array.isArray(data) ? data.length : 1,
    archived_at: new Date().toISOString(),
  };

  const encPath = path.join(outDir, `${name}.json.enc`);
  fs.writeFileSync(encPath, JSON.stringify(encPayload, null, 2), 'utf8');
  console.log(`[SAVED] ${name}: ${encPayload.record_count} records | SHA-256: ${sha256} | Encrypted: ${encPath}`);
  return { jsonPath, encPath, sha256, count: encPayload.record_count };
}

function extractFromStepOutput(stepFilePath) {
  if (!fs.existsSync(stepFilePath)) {
    throw new Error(`File not found: ${stepFilePath}`);
  }
  const raw = fs.readFileSync(stepFilePath, 'utf8');
  const parsed = JSON.parse(raw);
  const match = parsed.result.match(/<untrusted-data-[0-9a-f-]+>\s*(\[[\s\S]+?\])\s*<\/untrusted-data-[0-9a-f-]+>/);
  if (!match) throw new Error(`Could not find untrusted boundary in ${stepFilePath}`);
  const jsonArr = JSON.parse(match[1]);
  return jsonArr[0].json_agg;
}

const salt = 'BibleResearch:ejoperxiwxlcbsqrkrvb:private_macula_frame_vault:2026';

// 1. Process 200 restricted frame records from step 217 output
const frameRows = extractFromStepOutput('C:/Users/fluck/.gemini/antigravity/brain/665d66fd-5dd3-4293-8f5a-1ae633a34d7f/.system_generated/steps/217/output.txt');
encryptAndSave('macula_gated_restricted_frame_200', frameRows, salt);

// 2. Process 60 unmapped nodes from step 241 output
const unmappedRows = extractFromStepOutput('C:/Users/fluck/.gemini/antigravity/brain/665d66fd-5dd3-4293-8f5a-1ae633a34d7f/.system_generated/steps/241/output.txt');
encryptAndSave('macula_syntax_unmapped_nodes_60', unmappedRows, salt);

// 3. Process 983 import files from step 244 output
const importFilesRows = extractFromStepOutput('C:/Users/fluck/.gemini/antigravity/brain/665d66fd-5dd3-4293-8f5a-1ae633a34d7f/.system_generated/steps/244/output.txt');
encryptAndSave('macula_syntax_import_files_983', importFilesRows, salt);

console.log('\nAll 3 private datasets extracted, encrypted, and saved successfully.');
