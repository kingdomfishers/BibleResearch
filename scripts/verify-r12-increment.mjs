import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import z from "node:zlib";
import { createNodeFsAssetReader } from "../src/relationships/adjacency-loader.ts";
import {
  discoverBiblicalConnections,
  getConnectionEvidence,
} from "../src/relationships/r10-discovery.ts";
import { lemmaShardEntry } from "./relationship-shard-codec.mjs";
const root = path.resolve(".artifacts-r12/staging-bundle");
const reader = await createNodeFsAssetReader([root]);
// The frozen full outputs stay local; do not publish generated corpus packets.
const baseline = JSON.parse(
  fs.readFileSync(".artifacts-r12/continuation/baseline.json"),
);
const rows = [];
const oldTokens = new Map(), sourceMatches = new Set();
const selected = new Set(
  baseline.flatMap((b) =>
    b.result.strongest_connections.filter((c) =>
      c.evidence_id.startsWith("r11:gram:")
    ).flatMap((c) =>
      c.passages.map((p) => [p.book, p.chapter, p.verse].join(":"))
    )
  ),
);
const wanted = new Set(
  baseline.flatMap((b) =>
    b.result.strongest_connections.map((c) => c.evidence_id)
  ),
);
for (
  const f of fs.readdirSync(
    path.join(".artifacts-r12/continuation/evidence-passages-prepack"),
  )
) {
  const data = JSON.parse(
    z.gunzipSync(
      fs.readFileSync(
        path.join(".artifacts-r12/continuation/evidence-passages-prepack", f),
      ),
    ),
  );
  for (const v of Object.values(data.verses || {})) {
    const key = [v.book, v.chapter, v.verse].join(":");
    if (selected.has(key)) oldTokens.set(key, v.toks || []);
  }
}
const normalize = (k) => {
  const m = /([HG])0*(\d+)/.exec(k || "");
  return m ? m[1] + m[2].padStart(4, "0") : "";
};
for (
  const f of fs.readdirSync(
    path.join(root, "v2/relationships/r8-v1.2/evidence/by-summary"),
  )
) {
  const data = JSON.parse(
    z.gunzipSync(
      fs.readFileSync(
        path.join(root, "v2/relationships/r8-v1.2/evidence/by-summary", f),
      ),
    ),
  );
  for (const relations of Object.values(data.entries || {})) {
    for (const rel of relations) {
      if (rel.quality === "candidate") {
        continue;
      }
      const coord = [rel.coords.book, rel.coords.chapter, rel.coords.verse]
          .join(":"),
        tokens = oldTokens.get(coord) || [];
      const a = normalize(rel.subject.lemma_id),
        b = normalize(rel.object.lemma_id);
      if (
        !tokens.some((t) =>
          t.s === a && Number(t.wn) === rel.subject.word_position
        ) || !tokens.some((t) =>
          t.s === b && Number(t.wn) === rel.object.word_position
        )
      ) continue;
      for (
        const id of [
          `r11:gram:${a}:${rel.predicate}:${b}`,
          `r11:gram:${b}:${rel.predicate}:${a}`,
        ]
      ) if (wanted.has(id)) sourceMatches.add(id + "|" + coord);
    }
  }
}

for (const b of baseline) {
  const t = performance.now(),
    result = await discoverBiblicalConnections(reader, {
      query: b.query,
      limit: 10,
    });
  const grammar = result.strongest_connections.filter((c) =>
    c.evidence_id.startsWith("r11:gram:")
  );
  let witnesses = 0, verified = 0, oldVerified = 0, oldSlots = 0;
  for (const card of grammar) {
    const evidence = await getConnectionEvidence(reader, card.evidence_id);
    assert.equal(evidence.status, "ok");
    assert.ok(
      evidence.evidence.provenance.source_record_ids.every((id) =>
        id.startsWith("rel:")
      ),
    );
    const words = card.original_words.map((w) => w.strongs);
    for (const detail of evidence.passage_details) {
      witnesses++;
      assert.ok(
        words.every((bs) =>
          detail.original_tokens.some((t) => t.strongs === bs)
        ),
        `${card.evidence_id} ${detail.passage.ref}`,
      );
      verified++;
    }
  }
  for (
    const old of b.result.strongest_connections.filter((c) =>
      c.evidence_id.startsWith("r11:gram:")
    )
  ) {
    for (const p of old.passages) {
      oldSlots++;
      if (
        sourceMatches.has(
          old.evidence_id + `|${p.book}:${p.chapter}:${p.verse}`,
        )
      ) oldVerified++;
    }
  }
  rows.push({
    query: b.query,
    before_top10: b.result.strongest_connections.map((c) => c.evidence_id),
    after_top10: result.strongest_connections.map((c) => c.evidence_id),
    before_grammar_passages: oldSlots,
    before_verified_matching_passages: oldVerified,
    after_grammar_cards: grammar.length,
    after_grammar_passages: witnesses,
    after_verified_matching_passages: verified,
    before_ms: b.ms,
    after_ms: performance.now() - t,
    concepts: result.parsed_query.resolved_concepts.map((c) => ({
      term: c.input_token,
      lemmas: c.lemmas.map((l) => l.strongs),
    })),
    diversity: new Set(result.strongest_connections.map((c) =>
      c.predicate
    )).size,
  });
}
for (
  const [id, ref] of [["r11:gram:G3037:modifies:G5093", "1 Corinthians 3:12"], [
    "r11:gram:H5397:possessive_construction_with:H7307",
    "Genesis 7:22",
  ], ["r11:gram:H0231:grammatical_object_of:H3947", "Leviticus 14:4"]]
) {
  assert.ok(
    (await getConnectionEvidence(reader, id)).evidence.passages.some((p) =>
      p.ref === ref
    ),
  );
}
assert.equal(
  (await getConnectionEvidence(reader, "r11:gram:G3037:modifies:H7307")).status,
  "not_found",
);
assert.equal(
  (await discoverBiblicalConnections(reader, { query: "zzr12noattestation" }))
    .strongest_connections.length,
  0,
);
assert.ok(
  !(await discoverBiblicalConnections(reader, {
    query: "spirit wind",
    limit: 25,
  })).strongest_connections.some((c) =>
    c.evidence_id === "r11:intersect:verse:H7307:H7307:2"
  ),
);
// Exhaustive layout parity with the preserved pre-pack summaries, including
// counts, evidence IDs, provenance and every field except the redundant copy.
let keys = 0;
const packedFiles = new Map();
for (const dir of ["by-lemma", "chapter-lite"]) {
  for (
    const f of fs.readdirSync(path.join(root, "v2/relationships/r8-v1.2", dir))
  ) {
    const idx = JSON.parse(
      z.gunzipSync(
        fs.readFileSync(path.join(root, "v2/relationships/r8-v1.2", dir, f)),
      ),
    );
    const old = JSON.parse(
      z.gunzipSync(
        fs.readFileSync(
          path.join(".artifacts-r12/continuation", dir + "-prepack", f),
        ),
      ),
    );
    for (const [key, [file, start, length]] of Object.entries(idx.entries)) {
      if (!packedFiles.has(file)) {
        packedFiles.set(
          file,
          fs.readFileSync(path.join(root, "v2/relationships/r8-v1.2", file)),
        );
      }
      const bytes = packedFiles.get(file).subarray(start, start + length);
      const got = JSON.parse(z.gunzipSync(bytes));
      const expected = dir === "by-lemma"
        ? lemmaShardEntry(old, key)
        : old.chapters[key];
      assert.deepEqual(got, expected);
      keys++;
    }
  }
}
const report = {
  status: "pass",
  scope:
    "Local staging assets; grammatical-card witnesses only. Other claim classes and theological significance are not scored.",
  layout_keys_verified: keys,
  negative_controls: [
    "nonexistent grammatical cross-language pair",
    "unknown concept",
    "same-token spirit/wind",
  ],
  rows,
};
fs.writeFileSync(
  ".artifacts-r12/continuation/discovery-comparison.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(
  {
    status: report.status,
    layout_keys_verified: keys,
    before_slots: rows.reduce((s, r) => s + r.before_grammar_passages, 0),
    before_verified: rows.reduce(
      (s, r) => s + r.before_verified_matching_passages,
      0,
    ),
    after_slots: rows.reduce((s, r) => s + r.after_grammar_passages, 0),
    after_verified: rows.reduce(
      (s, r) => s + r.after_verified_matching_passages,
      0,
    ),
  },
  null,
  2,
));
