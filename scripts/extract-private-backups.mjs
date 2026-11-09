// scripts/extract-private-backups.mjs
// Extracts and saves encrypted datasets:
// 1. 200 restricted frame records from public.macula_gated_field_values
// 2. 60 records from bible_internal.macula_syntax_unmapped_nodes
// 3. 983 records from bible_internal.macula_syntax_import_files
// into .artifacts/private-backup/ with AES-256-GCM encryption and plaintext SHA-256 verification.
//
// SECURITY: Plaintext JSON is NEVER written to disk. The encryption passphrase must be supplied
// via the PRIVATE_BACKUP_PASSPHRASE environment variable.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const outDir = path.resolve('.artifacts/private-backup');
fs.mkdirSync(outDir, { recursive: true });

export function encryptAndSave(name, data, secretSalt) {
  if (!secretSalt || typeof secretSalt !== 'string' || secretSalt.length < 16) {
    throw new Error('A strong secret passphrase (min 16 chars) is required for encryption.');
  }

  const plaintext = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
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
  console.log(`[ENCRYPTED] ${name}: ${encPayload.record_count} records | SHA-256: ${sha256} | Encrypted: ${encPath}`);
  return { encPath, sha256, count: encPayload.record_count };
}

function extractFromStepOutput(stepFilePath) {
  if (!fs.existsSync(stepFilePath)) {
    throw new Error(`Step file not found: ${stepFilePath}`);
  }
  const raw = fs.readFileSync(stepFilePath, 'utf8');
  const parsed = JSON.parse(raw);
  const match = parsed.result.match(/<untrusted-data-[0-9a-f-]+>\s*(\[[\s\S]+?\])\s*<\/untrusted-data-[0-9a-f-]+>/);
  if (!match) throw new Error(`Could not find untrusted boundary in ${stepFilePath}`);
  const jsonArr = JSON.parse(match[1]);
  return jsonArr[0].json_agg;
}

if (process.argv.includes('--run')) {
  const salt = process.env.PRIVATE_BACKUP_PASSPHRASE;
  if (!salt) {
    console.error('ERROR: PRIVATE_BACKUP_PASSPHRASE environment variable is required.');
    process.exit(1);
  }

  const p200 = process.env.FRAME_200_PATH;
  const p60 = process.env.UNMAPPED_60_PATH;
  const p983 = process.env.IMPORT_FILES_983_PATH;

  if (p200 && fs.existsSync(p200)) {
    encryptAndSave('macula_gated_restricted_frame_200', extractFromStepOutput(p200), salt);
  }
  if (p60 && fs.existsSync(p60)) {
    encryptAndSave('macula_syntax_unmapped_nodes_60', extractFromStepOutput(p60), salt);
  }
  if (p983 && fs.existsSync(p983)) {
    encryptAndSave('macula_syntax_import_files_983', extractFromStepOutput(p983), salt);
  }
  console.log('Private backup encryption complete.');
}
