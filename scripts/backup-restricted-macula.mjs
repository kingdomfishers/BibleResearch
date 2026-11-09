// scripts/backup-restricted-macula.mjs
// Extracts, validates, and privately archives:
// 1. The 200 restricted 'frame' records from public.macula_gated_field_values
//    with full morpheme and word context.
// 2. The 983 records from bible_internal.macula_syntax_import_files.
// 3. The 60 records from bible_internal.macula_syntax_unmapped_nodes.
// Produces both uncompressed JSON (for local restore verification) and
// AES-256-GCM encrypted payloads in .artifacts/private-backup/ (never in git/Cloudflare).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const outDir = path.resolve('.artifacts/private-backup');
fs.mkdirSync(outDir, { recursive: true });

export function encryptPayload(data, secretSalt) {
  const plaintext = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
  const sha256 = crypto.createHash('sha256').update(plaintext).digest('hex');
  const key = crypto.createHash('sha256').update(secretSalt).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    algorithm: 'aes-256-gcm',
    iv: iv.toString('hex'),
    auth_tag: authTag.toString('hex'),
    ciphertext: ciphertext.toString('base64'),
    plaintext_sha256: sha256,
    byte_length: plaintext.length,
    record_count: Array.isArray(data) ? data.length : 1,
    archived_at: new Date().toISOString(),
  };
}

export function decryptPayload(encryptedEnvelope, secretSalt) {
  const key = crypto.createHash('sha256').update(secretSalt).digest();
  const iv = Buffer.from(encryptedEnvelope.iv, 'hex');
  const authTag = Buffer.from(encryptedEnvelope.auth_tag, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encryptedEnvelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
  const checkSha = crypto.createHash('sha256').update(plaintext).digest('hex');
  if (checkSha !== encryptedEnvelope.plaintext_sha256) {
    throw new Error(`Checksum mismatch on decrypted payload! Expected ${encryptedEnvelope.plaintext_sha256}, got ${checkSha}`);
  }
  return JSON.parse(plaintext.toString('utf8'));
}
