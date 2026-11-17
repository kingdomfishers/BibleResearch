/** Read-only staging acceptance. No retries: runtime failures remain visible. */
import fs from "node:fs";
import assert from "node:assert/strict";
const corpus =
  "https://bibleresearch-corpus-staging.kingdomfishers-custom.workers.dev";
const mcp =
  "https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp-staging/mcp";
const rows = [];
let id = 0;
async function post(op, args) {
  const started = performance.now();
  const response = await fetch(`${corpus}/v1/rpc/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 6000) };
  }
  rows.push({
    op,
    args,
    http: response.status,
    ms: Math.round(performance.now() - started),
    cf_ray: response.headers.get("cf-ray"),
    version: response.headers.get("X-BibleResearch-Version"),
    release: response.headers.get("X-BibleResearch-Release"),
    asset_sha256: response.headers.get("X-BibleResearch-Assets"),
    error: response.ok ? undefined : data,
  });
  assert.equal(
    response.status,
    200,
    `${op}: ${response.status} ${text.slice(0, 120)}`,
  );
  assert.equal(
    response.headers.get("X-BibleResearch-Release"),
    "r12-witnesses-1",
  );
  return data;
}
async function call(name, args) {
  const response = await fetch(mcp, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text.slice(0, 150));
  const packet =
    response.headers.get("content-type")?.includes("text/event-stream")
      ? JSON.parse(text.split("\n").find((l) => l.startsWith("data:")).slice(5))
      : JSON.parse(text);
  assert.ok(!packet.error && !packet.result.isError, text.slice(0, 800));
  const data = packet.result.structuredContent;
  assert.equal(data.verification_release.corpus_target, "staging");
  assert.equal(data.verification_release.corpus_release, "r12-witnesses-1");
  assert.ok(data.verification_release.worker_version);
  return data;
}
let failure;
try {
  const workload = [
    ["get_reader_passages_v1", {
      p_passages: [{ book: 1, chapter: 1, verse: 2 }],
    }],
    ["query_relationships_v2", {
      op: "unified_lemma",
      query: "H7307",
      word_id: 130555,
      book: 1,
      chapter: 1,
      verse: 2,
      position: 9,
    }],
    ["query_relationships_v2", {
      op: "unified_lemma",
      query: "G3056",
      book: 43,
      chapter: 1,
      verse: 1,
      position: 5,
    }],
    ["query_relationships_v2", {
      op: "contextual_neighbors",
      query: "H7307",
      contextual_scope: "same_clause",
      limit: 25,
    }],
    ["discover_biblical_connections_v2", {
      query: "scarlet Tamar Rahab Matthew 1",
    }],
    ["discover_biblical_connections_v2", { query: "well" }],
    ["get_connection_evidence_v1", {
      evidence_id: "r11:gram:G3037:modifies:G5093",
    }],
    ["get_connection_evidence_v1", {
      evidence_id: "r11:gram:H5397:possessive_construction_with:H7307",
    }],
  ];
  for (let round = 0; round < 3; round++) {
    const result = await Promise.allSettled(
      workload.map(([op, args]) => post(op, args)),
    );
    assert.ok(
      result.every((r) => r.status === "fulfilled"),
      JSON.stringify(
        result.map((r) => r.status === "rejected" ? r.reason.message : "ok"),
      ),
    );
    console.log(`PASS bounded concurrent round ${round + 1}: 8/8`);
  }
  for (
    const [query, book, chapter, verse, position, word_id] of [
      ["H7307", 1, 1, 2, 9, 130555],
      ["H6440", 1, 1, 2, 7, 118734],
      ["H6440", 1, 1, 2, 13, 118736],
      ["G3056", 43, 1, 1, 5, 15230],
      ["G3056", 43, 1, 1, 8, 15229],
      ["G3056", 43, 1, 1, 17, 15231],
      ["H1732", 19, 3, 0, 2, 53063],
    ]
  ) {
    const args = { query, book, chapter, verse, position };
    const direct = await post("query_relationships_v2", {
      op: "unified_lemma",
      ...args,
    });
    assert.equal(direct.resolved_occurrence.word_id, word_id);
    const viaMcp = await call("get_unified_word_relationships_v2", args);
    assert.equal(viaMcp.resolved_occurrence.word_id, word_id);
  }
  const mismatch = await call("get_unified_word_relationships_v2", {
    query: "H7307",
    word_id: 130555,
    book: 1,
    chapter: 1,
    verse: 2,
    position: 2,
  });
  assert.equal(mismatch.status, "selector_mismatch");
  for (const scope of ["same_clause", "collocation"]) {
    const r = await call("page_contextual_neighbors_v2", {
      query: "H7307",
      contextual_scope: scope,
      limit: 25,
    });
    const items = r.contextual?.items || r.layers?.contextual?.items;
    assert.ok(items?.length);
    assert.ok(
      items.every((i) =>
        i.sample_passages.some((p) =>
          scope === "same_clause" ? p.in_same_clause : p.is_collocation
        )
      ),
    );
  }
  const swete = await call("get_septuagint_passage", {
    p_book_no: 1,
    p_chapter: 32,
    p_verse_nr: 1,
  });
  assert.equal(swete.tokens[0].word_text, "εἰς");
  assert.equal(swete.tokens[0].raw_source_word_text, "XXXIIεἰς");
  const hagar = await call("discover_biblical_connections_v2", {
    query: "Hagar seeing eyes spring",
  });
  const h = hagar.parsed_query.resolved_concepts.find((c) =>
    c.normalized === "hagar"
  );
  assert.ok(h.lemmas.some((l) => l.strongs === "H1904"));
  assert.ok(!h.lemmas.some((l) => l.strongs === "H1481"));
  const spirit = await call("discover_biblical_connections_v2", {
    query: "spirit wind",
  });
  assert.ok(
    !spirit.strongest_connections.some((c) =>
      c.evidence_id === "r11:intersect:verse:H7307:H7307:2"
    ),
  );
  for (
    const evidence_id of [
      "r11:gram:G3037:modifies:G5093",
      "r11:gram:H5397:possessive_construction_with:H7307",
      "r11:gram:H0231:grammatical_object_of:H3947",
    ]
  ) {
    const r = await call("get_connection_evidence_v1", { evidence_id });
    assert.equal(r.status, "ok");
    const codes = r.evidence.original_words.map((w) => w.strongs);
    assert.ok(
      r.passage_details.every((p) =>
        codes.every((bs) => p.original_tokens.some((t) => t.strongs === bs))
      ),
    );
  }
  const health = await (await fetch(mcp.replace("/mcp", "/health"))).json();
  assert.equal(health.read_only, true);
  assert.equal(health.writes, "disabled");
  console.log(
    "PASS live identities, selectors, contextual witnesses, Swete, discovery and MCP release evidence",
  );
} catch (error) {
  failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  fs.mkdirSync(".artifacts-r12/continuation", { recursive: true });
  fs.writeFileSync(
    ".artifacts-r12/continuation/live.json",
    JSON.stringify(
      { status: failure ? "failed" : "passed", corpus, mcp, failure, rows },
      null,
      2,
    ),
  );
}
