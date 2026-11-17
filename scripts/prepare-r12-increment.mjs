/** Incremental R12 staging-only layout and grammatical witness enrichment. No source rebuild. */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { lemmaShardEntry } from "./relationship-shard-codec.mjs";
const root = path.resolve(process.argv[2] || ".artifacts-r12/staging-bundle");
assert.ok(root.toLowerCase().includes("staging"), "Staging bundle required");
const gram = path.join(root, "v2/relationships/r8-v1.2");
const packedCache = new Map();
function read(p) {
  const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(p)));
  if (d.schema_version !== "r10-packed-1") return d;
  const pairs = Object.entries(d.entries).map(
    ([key, [blob, start, length]]) => {
      const blobPath = path.join(root, "v2/relationships/r11-v1.0/r10", blob);
      if (!packedCache.has(blobPath)) {
        packedCache.set(blobPath, fs.readFileSync(blobPath));
      }
      const bytes = packedCache.get(blobPath).subarray(start, start + length);
      const value = JSON.parse(
        bytes[0] === 31 && bytes[1] === 139 ? zlib.gunzipSync(bytes) : bytes,
      );
      if (d.reference_keys) {
        const { verse_id, ...original } = value;
        return [String(verse_id), original];
      }
      return [key, value];
    },
  );
  return { [d.field]: d.pairs ? pairs : Object.fromEntries(pairs) };
}
const write = (p, d) => {
  const temp = p + ".r12-tmp";
  fs.writeFileSync(temp, zlib.gzipSync(JSON.stringify(d), { level: 9 }));
  fs.renameSync(temp, p);
};
const bs = (k) => {
  const m = /([HG])0*(\d+)/.exec(k || "");
  return m ? m[1] + m[2].padStart(4, "0") : "";
};
// Every projected edge retains its source relation. Mirrored edges and editions
// with identical canonical token positions contribute one clause witness.
const groups = new Map();
const add = (r, from, to, direction) => {
  const key = [bs(from), r.predicate, bs(to), direction].join("|");
  if (!groups.has(key)) groups.set(key, new Map());
  const clause = r.relation_id.split("#")[1]?.split(":")[0] || "";
  const group = [r.canonical_ref, clause].join("|");
  const witnesses = groups.get(key);
  if (!witnesses.has(group)) {
    witnesses.set(group, {
      relation_id: r.relation_id,
      clause_key: group,
      edition: r.edition,
      subject_token_id: r.subject.source_token_id || r.subject.token_id,
      object_token_id: r.object.source_token_id || r.object.token_id,
      subject_strongs: bs(r.subject.lemma_id),
      object_strongs: bs(r.object.lemma_id),
      subject_position: r.subject.word_position,
      object_position: r.object.word_position,
      coords: r.coords,
      ref: r.canonical_ref,
    });
  }
};
for (const f of fs.readdirSync(path.join(gram, "evidence/by-summary")).sort()) {
  const d = read(path.join(gram, "evidence/by-summary", f));
  for (const relations of Object.values(d.entries || {})) {
    for (const r of relations) {
      if (r.quality === "candidate") {
        continue;
      }
      add(r, r.subject.lemma_id, r.object.lemma_id, "outgoing");
      add(r, r.object.lemma_id, r.subject.lemma_id, "incoming");
    }
  }
}
const r10 = path.join(root, "v2/relationships/r11-v1.0/r10");
const verseMap = new Map(), tokenMap = new Map();
for (const f of fs.readdirSync(path.join(r10, "evidence-passages"))) {
  const d = read(path.join(r10, "evidence-passages", f));
  for (const [id, v] of Object.entries(d.verses || {})) {
    tokenMap.set(`${v.book}:${v.chapter}:${v.verse}`, v.toks || []);
    verseMap.set(`${v.book}:${v.chapter}:${v.verse}`, {
      verse_id: Number(id),
      ref: v.ref,
      book: v.book,
      chapter: v.chapter,
      verse: v.verse,
      testament: v.book <= 39 ? "OT" : "NT",
      snippet: v.en,
      is_psalm_heading: v.book === 19 && v.verse === 0,
    });
  }
}
let matched = 0, missing = 0;
for (const dir of ["lemma-profiles", "fast-profiles"]) {
  for (const f of fs.readdirSync(path.join(r10, dir))) {
    const p = path.join(r10, dir, f), d = read(p);
    for (const profile of Object.values(d.entries || {})) {
      for (const gr of profile.grammatical_relations || []) {
        const found = [
          ...(groups.get(
            [profile.bs, gr.predicate, gr.related_strongs, gr.direction].join(
              "|",
            ),
          )?.values() || []),
        ].sort((a, b) => a.clause_key.localeCompare(b.clause_key));
        const verified = found.filter((w) => {
          const tokens = tokenMap.get(
            `${w.coords.book}:${w.coords.chapter}:${w.coords.verse}`,
          ) || [];
          return tokens.some((t) =>
            Number(t.wn) === w.subject_position && t.s === w.subject_strongs
          ) && tokens.some((t) =>
            Number(t.wn) === w.object_position && t.s === w.object_strongs
          );
        });
        gr.source_clause_count = found.length;
        gr.independent_witness_count = verified.length;
        gr.witnesses = verified.filter((w) =>
          verseMap.has(`${w.coords.book}:${w.coords.chapter}:${w.coords.verse}`)
        ).slice(0, 3).map((w) => ({
          ...w,
          passage: verseMap.get(
            `${w.coords.book}:${w.coords.chapter}:${w.coords.verse}`,
          ),
        }));
        gr.witness_status = gr.witnesses.length
          ? "verified_matching_witness"
          : "matching_witness_not_returned";
        gr.witnesses.length ? matched++ : missing++;
      }
    }
    write(p, d);
  }
}
// Pack independent gzip records into bounded files. Existing 256/64 index paths
// are retained; Range reads decompress just one lemma or chapter, not a bucket.
let packedBytes = 0;
if (!process.argv.includes("--witnesses-only")) {
  for (
    const [dir, field, count] of [["by-lemma", "entries", 8], [
      "chapter-lite",
      "chapters",
      4,
    ]]
  ) {
    const parts = Array.from({ length: count }, () => []),
      offsets = Array(count).fill(0);
    for (const f of fs.readdirSync(path.join(gram, dir)).sort()) {
      const p = path.join(gram, dir, f), d = read(p);
      const snapshot = path.join(
        ".artifacts-r12/continuation",
        dir + "-prepack",
      );
      fs.mkdirSync(snapshot, { recursive: true });
      fs.copyFileSync(p, path.join(snapshot, f));
      assert.notEqual(
        d.schema_version,
        "packed-1",
        "Already packed; regenerate index from the preserved pre-pack copy before rebuilding",
      );
      const entries = {};
      for (const key of Object.keys(d[field] || {}).sort()) {
        let record = dir === "by-lemma"
          ? lemmaShardEntry(d, key)
          : d[field][key];
        if (dir === "by-lemma") {
          for (const field of ["outgoing_summaries", "incoming_summaries"]) {
            for (const summary of record[field] || []) {
              delete summary.sample_relations;
            }
          }
        }
        const bytes = Buffer.from(
          zlib.gzipSync(JSON.stringify(record), { level: 6 }),
        );
        const n = offsets.indexOf(Math.min(...offsets)),
          file = `packed-${dir}-${n}.bin`;
        entries[key] = [file, offsets[n], bytes.length];
        parts[n].push(bytes);
        offsets[n] += bytes.length;
        // Exact content parity for every packed key, not just selected QA examples.
        assert.deepEqual(JSON.parse(zlib.gunzipSync(bytes)), record);
      }
      write(p, { schema_version: "packed-1", entries });
    }
    parts.forEach((buffers, i) => {
      assert.ok(offsets[i] <= 25 * 1024 * 1024);
      fs.writeFileSync(
        path.join(gram, `packed-${dir}-${i}.bin`),
        Buffer.concat(buffers),
      );
      packedBytes += offsets[i];
    });
  }
}
// R11 keeps its existing index paths. Eight shared blobs leave one free asset
// slot and preserve all old releases. No whole-corpus runtime scan is introduced.
if (!process.argv.includes("--skip-discovery-pack")) {
  const parts = Array.from({ length: 8 }, () => []), offsets = Array(8).fill(0);
  for (
    const [dir, field] of [
      ["lemma-lookup", "entries"],
      ["fast-profiles", "entries"],
      ["fast-verses", "verses"],
      ["evidence-passages", "verses"],
    ]
  ) {
    for (const f of fs.readdirSync(path.join(r10, dir)).sort()) {
      console.log("Packing", dir, f);
      const p = path.join(r10, dir, f), d = read(p), entries = {};
      if (dir === "evidence-passages") {
        const snapshot =
          ".artifacts-r12/continuation/evidence-passages-prepack";
        fs.mkdirSync(snapshot, { recursive: true });
        write(path.join(snapshot, f), d);
      }
      const pairs = Array.isArray(d[field])
        ? d[field]
        : Object.entries(d[field] || {});
      for (const [key, value] of pairs) {
        const reference = dir === "evidence-passages";
        const record = reference ? { ...value, verse_id: Number(key) } : value;
        const bytes = Buffer.from(
          zlib.gzipSync(JSON.stringify(record), { level: 6 }),
        );
        const n = offsets.indexOf(Math.min(...offsets));
        entries[reference ? value.chapter + ":" + value.verse : key] = [
          "packed-discovery-" + n + ".bin",
          offsets[n],
          bytes.length,
        ];
        parts[n].push(bytes);
        offsets[n] += bytes.length;
        assert.deepEqual(JSON.parse(zlib.gunzipSync(bytes)), record);
      }
      write(p, {
        schema_version: "r10-packed-1",
        field,
        pairs: Array.isArray(d[field]),
        reference_keys: dir === "evidence-passages",
        entries,
        ...(dir === "evidence-passages"
          ? {
            chapter_vids: Object.fromEntries(
              [...new Set(pairs.map(([, v]) => String(v.chapter)))].map(
                (ch) => [
                  ch,
                  pairs.filter(([, v]) => String(v.chapter) === ch).map((
                    [vid],
                  ) => Number(vid)),
                ],
              ),
            ),
          }
          : {}),
      });
    }
  }
  parts.forEach((buffers, i) => {
    assert.ok(offsets[i] <= 25 * 1024 * 1024);
    const file = path.join(r10, "packed-discovery-" + i + ".bin");
    fs.writeFileSync(file + ".r12-tmp", Buffer.concat(buffers));
    fs.renameSync(file + ".r12-tmp", file);
  });
  const fast = read(path.join(r10, "fast-manifest.json.gz"));
  fast.packed = true;
  fast.witness_version = "r12-witnesses-1";
  write(path.join(r10, "fast-manifest.json.gz"), fast);
}
const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]
  );
const files = walk(root);
assert.ok(files.length <= 20000, `${files.length} exceeds Free limit`);
assert.ok(files.every((p) => fs.statSync(p).size <= 25 * 1024 * 1024));
const digest = crypto.createHash("sha256");
for (const p of files.sort()) {
  digest.update(path.relative(root, p).replaceAll("\\", "/"));
  digest.update(
    crypto.createHash("sha256").update(fs.readFileSync(p)).digest(),
  );
}
const report = {
  release: "r12-witnesses-1",
  files: files.length,
  packed_bytes: files.filter((p) => /packed-.*\.bin$/.test(p)).reduce(
    (sum, p) => sum + fs.statSync(p).size,
    0,
  ),
  matched_profile_relations: matched,
  missing_profile_relations: missing,
  asset_sha256: digest.digest("hex"),
};
fs.mkdirSync(".artifacts-r12/continuation", { recursive: true });
fs.writeFileSync(
  ".artifacts-r12/continuation/assets.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
