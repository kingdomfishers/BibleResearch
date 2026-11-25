# BibleResearch Deep Research Audit: Algorithms, Open Data, and Static-Edge Architecture

Research date: 25 November 2026.

## Research scope and status

This document preserves the completed Deep Research report recovered from the ChatGPT Library. The earlier publication-status text and temporary download link have been removed, and source URLs have been restored for GitHub readability. The separately advertised longer Markdown export was not available in the publishing session. Findings have not been independently re-benchmarked against this repository; proposed algorithms, CPU budgets and licensing decisions require the checks described below.

The investigation re-audited earlier claims rather than trusting the previous report. In particular, it rechecked Open Scriptorium LXX morphology, CATSS restrictions, CenterBLC/NuBerea provenance, MACULA field-level licensing, HELFI, UBS dictionaries, T’OMIM, Tesserae v6's October 2026 license change, and the current Cloudflare Worker limits.

## LXX morphology and MT↔LXX alignment

The strongest new dataset finding remains **Open Scriptorium `lxx-morph`**, but the deeper audit materially sharpens how it should be used. The repository contains word-level morphology for all 59 books of Rahlfs 1935, with `surface`, `lemma`, `parsing`, `pos`, and explicit derivation provenance (`source`, `confidence`, `reasoning`). Final data are stored as per-book JSON files under `db/seeds/lxx_morph/`; intermediate worklists and corrections are JSONL. The **data are CC BY 4.0**, while the software pipeline is **ISC**, which means the morphology itself passes your allowlist but the accompanying pipeline code does not under a literal reading of your policy. Open Scriptorium also now includes `db/seeds/mt_alignment/verse_pairs.jsonl`, resolving verse-level MT↔LXX correspondences including Jeremiah reordering, Psalms offsets, 2 Esdras, and tabernacle-material differences. The repository describes this explicitly as the foundation for a future word-level alignment, rather than a finished MT↔LXX token alignment. [Open Scriptorium repository and dataset documentation](https://github.com/OpenScriptorium/lxx-morph/blob/master/README.md). That makes the recommended architecture clearer:

$$
\text{Swete tokens}
\leftrightarrow
\text{Rahlfs tokens}
\leftrightarrow
\text{Rahlfs morphology}
$$

and independently:

$$
\text{MT tokens}
\leftrightarrow
\text{Rahlfs LXX tokens}
$$

Swete and Rahlfs should remain distinct witnesses. Morphology should transfer only over high-confidence edition alignments, while unmatched tokens remain explicit edition variants.

CATSS remains invaluable for comparison, but it clearly fails the deployment license gate. The modern `curran-gehring/catss` wrapper states that it consumes CCAT's morphologically analyzed LXX and Emanuel Tov's MT/LXX parallel alignment, that CATSS redistribution remains governed by the CCAT user agreement, and that commercial use requires written consent. The wrapper itself is CC BY-NC 4.0. It therefore cannot supply redistributed BibleResearch data under your stated license policy. The CATSS wrapper is nevertheless exceptionally useful as an **error catalogue**. It documents Psalms numbering divergence, Lamentations' Greek prologue shifting the alignment numbering, a missing Joshua 22 header, merged verse headers in Deuteronomy 28/Ezekiel 34/Daniel 7, a `Numbers 6:45` typo actually belonging to Numbers 26:45, Esther addition subverses being collapsed, and superscriptions represented as verse 0 in morphology. Those cases should become regression tests in BibleResearch's own canonical-reference layer. [CATSS pipeline and documented issues](https://github.com/curran-gehring/catss/blob/main/README.md); [CrossWire CATSS license](https://www.crosswire.org/sword/modules/ModInfo.jsp?experimental=true&modName=LXXM). The provenance audit also changes how CenterBLC and NuBerea should be treated. `CenterBLC/LXX` explicitly states that its Rahlfs data derive from Eliran Wong's edition, which in turn is based on CATSS. Consequently, a permissive top-level repository license does not by itself resolve the rights of the inherited CATSS-derived content. The downstream NuBerea Septuagint and LXX-WLC bridge similarly advertise permissive licenses, but their own cards identify CenterBLC as an upstream. Under your transitive-rights rule, they should remain **quarantined** until a clean derivation is established. [CenterBLC LXX](https://github.com/CenterBLC/LXX); [NuBerea LXX](https://huggingface.co/datasets/NuBerea/septuagint-lxx); [NuBerea bridge](https://huggingface.co/datasets/NuBerea/lxx-wlc-bridge). For independent MT↔LXX alignment, **fast_align** remains the best permissively licensed statistical baseline. Dyer, Chahuneau and Smith's NAACL 2013 aligner is Apache-2.0, accepts sentence-aligned parallel corpora, emits Pharaoh `i-j` token links, and explicitly supports forward/reverse runs followed by symmetrization such as `grow-diag-final-and`. Conceptually:

$$
P(a_j=i\mid H,G)
\propto
t(g_j\mid h_i)
\,
q(i,j,m,n)
$$

where \(t\) learns Hebrew–Greek lexical correspondence and \(q\) supplies a positional prior.

For LXX translation, however, positional agreement should not dominate because translator literalness and word-order freedom vary by book. BibleResearch should therefore retain forward and reverse probabilities separately and add morphology and MACULA role compatibility as a reranking layer.

**SimAlign** provides a second independent signal. Its code is MIT, and the 2020 paper showed embedding-based alignment competitive with or superior to statistical systems on several modern-language pairs, but those experiments did **not** establish comparable accuracy for Biblical Hebrew↔Koine Greek. Treat it as an offline comparison channel, and audit whatever embedding weights it uses separately from the MIT application code. HELFI also survived the re-audit in a narrower form than one might initially assume. Its **alignment-link layer** is CC BY 4.0, while its texts, lemmas, and morphology retain separate licenses. It therefore provides an admissible alignment schema/evaluation reference, but not a turnkey direct MT↔LXX gold corpus. [HELFI license details](https://github.com/amikael/HELFI/blob/master/LICENSES.md). The recommended production record is therefore not merely `HebrewWord → GreekWord`, but something closer to:

```text
verse_group_id
mt_token_id
lxx_token_id
p_hebrew_to_greek
p_greek_to_hebrew
symmetrization_method
role_compatibility
morphology_compatibility
status = aligned | addition | omission | phrase | uncertain
provenance_id
```

The critical evaluation metric should include Alignment Error Rate alongside separate precision/recall for one-to-one links, phrases, function words, proper names, additions, and omissions. A corpus-wide number alone can hide exactly the asymmetries BibleResearch is meant to expose.

## Semantic domains and physical-world ontologies

The re-audit confirms that the best directly biblical semantic-domain resources are unfortunately outside your literal allowlist.

UBS's open repository contains its Biblical Hebrew dictionary derived from SDBH and its Greek dictionary derived from the Louw–Nida tradition. The Hebrew resource supplies lexical analyses, glosses, Scripture references and semantic domains; UBS states that the resource covers roughly 90% of OT vocabulary currently represented. Both Hebrew and Greek resources are downloadable as XML or JSON. But the collection is **CC BY-SA 4.0**, not CC BY 4.0. Under your strict policy they therefore cannot be imported directly. [UBS open-license collection](https://github.com/ubsicap/ubs-open-license). The same issue applies to ConceptNet: its aggregate graph is CC BY-SA 4.0. BabelNet is more restrictive still, with noncommercial/research-institution conditions on the inter-resource network. Both should be excluded from the production corpus. [ConceptNet](https://conceptnet.io/); [BabelNet license](https://babelnet.org/license). The strongest admissible combination is therefore **Open English WordNet + Wikidata**.

Open English WordNet is CC BY 4.0, distributed in Global WordNet LMF-compatible formats, and explicitly supports synsets and typed lexical relations. Wikidata structured data are CC0. Its official policy states that structured data in the main, property, lexeme and EntitySchema namespaces are released under CC0. The correct architecture is not:

```text
Hebrew lemma
→ English gloss
→ every WordNet sense
```

but:

```text
Hebrew/Greek lemma
→ contextual lexical sense
→ verified OEWN synset
→ physical/entity ontology
→ Wikidata concept/process
```

That sense-gating step is essential. “Hand,” “seed,” “head,” “spirit,” “house,” “branch,” or “fruit” all have substantial English polysemy. Mapping a biblical lemma to every English synset would manufacture large numbers of false relations.

A useful probabilistic formulation is:

$$
P(s\mid w,c)
\propto
P(s\mid w)
P(r\mid s)
P(t\mid s)
P(c\mid s)
$$

where \(r\) is MACULA role evidence and \(t\) represents observed translation equivalents.

For the physical-world layer, a small curated Wikidata subgraph is preferable to a full dump. Useful relationships include `instance of`, `subclass of`, `part of`, `has part`, `parent taxon`, `material used`, `use`, and `uses`. The initial scope should emphasize flora, fauna, anatomy, agriculture, architecture, tools, textiles, food preparation, liquids, celestial phenomena and ritual objects. MACULA itself requires field-level licensing discipline. MACULA Greek's license file places its own syntax trees, morphology, semantic frames, participant referents and mappings under CC BY 4.0, but separately identifies MARBLE/Louw–Nida word-sense material as being “used with permission.” That distinction means BibleResearch should not infer that every attribute in the repository inherits the same redistribution rights. [MACULA Greek field-level license](https://github.com/Clear-Bible/macula-greek/blob/main/LICENSE.md). This leads to a broader provenance rule for BibleResearch: licenses need to be attached to **fields and transformations**, not just repositories.

## Intertextuality and graph algorithms

The most important correction from the deeper web audit concerns **Tesserae v6**. Its *current* repository license is indeed **PolyForm Noncommercial 1.0.0**, with project-owned datasets under CC BY-NC 4.0; the current README states that versions before **25 October 2026** were MIT licensed. Thus the earlier warning about the license change was correct, even though some search-index snapshots still display “MIT.” The live repository text is the higher-confidence source. That creates a useful but narrow option: a specific pre-25-October-2026 snapshot may remain available under the MIT license it originally received, but BibleResearch should not rely on “some earlier version” abstractly. An exact commit and every bundled dataset's own rights need to be pinned before copying code. I could not independently establish a safe SHA during this research, so the report deliberately does not invent one. [Tesserae v6 current repository](https://github.com/tesserae/tesserae-v6).

Tesserae's current architecture nonetheless validates several ideas already aligned with BibleResearch: rare words, word pairs, exact matches, sound, edit distance, quotations, semantic matching, dictionary matching, syntactic matching and syntax-only structural matching are fused into one intertextuality system; v6 also explicitly supports Hebrew→Greek traversal through the Septuagint. The directly reusable research principle is **relational rarity**, not merely word rarity. Two individually common terms may form an extremely distinctive pair.

A useful candidate score is:

$$
S(A,B)=
\frac{
\sum_{m\in M}IDF(m)
+
\gamma\sum_{(x,y)\in P}NPMI(x,y)
}{
1+\log(1+span_A)+\log(1+span_B)
}
$$

with NPMI estimated both corpus-wide and within genre/book. This prevents a conventional narrative formula from appearing highly distinctive merely because it is rare outside its genre.

For modified quotations, **Smith–Waterman local sequence alignment** is still one of the best fits. Unlike TF-IDF, it respects order while tolerating substitutions and inserted/deleted material. Applied only after inverted-index candidate retrieval, it is computationally inexpensive. Scoring should privilege exact original-language lemma matches and high-confidence LXX translation equivalents, then morphology/sense/role matches, with penalties for unrelated substitutions and gaps.

Graph discovery should also change from “BFS then rank” toward **typed Personalized PageRank/local push then explanation**.

$$
p=\alpha s+(1-\alpha)P^Tp
$$

The key modification is relation-family normalization:

$$
P(v\to u)
=
\rho_{\text{relation}}
\frac{w(v,u)}
{\sum_{x\in N_{\text{relation}}(v)}w(v,x)}
$$

This prevents a node with hundreds of semantic associations from overwhelming a handful of much stronger quotation or translation edges.

Your bounded Steiner search should remain, but its role changes: **PPR identifies the relevant neighborhood; Steiner constructs the concise explanatory connection between selected terminals.**

Metapaths provide another improvement over BFS because they define what kind of relationship chain is meaningful. PathSim's original formulation is intended for symmetric metapaths, so it should not be blindly applied to asymmetric Hebrew→LXX→NT traversal. Symmetric cases can use:

$$
PathSim(x,y)=
\frac{2M(x,y)}
{M(x,x)+M(y,y)}
$$

while asymmetric paths should use separately normalized path probabilities or typed random walks. Optimal transport and tree kernels remain worthwhile, but mostly as **offline or shortlist rerankers**. Word Mover-style optimal transport can match semantic content even when surface vocabulary differs, while Collins–Duffy-style tree fragments can capture shared syntactic structures. Their usefulness is highest when the transport/tree cost is defined over original-language lemmas, MACULA roles and MT↔LXX correspondences—not modern English embeddings alone.

## Structural discovery: chiasm, parallelism, cadence, and narrative patterns

The most directly relevant new peer-reviewed biblical work is McGovern, Sirin and Lippincott's **“Computational Discovery of Chiasmus in Ancient Religious Text,” NAACL 2025**, DOI 10.18653/v1/2025.naacl-short.13. Their system uses lexical/semantic representations at verse and half-verse granularity and reports 0.80 system accuracy at verse level and 0.60 at half-verse level for the reviewed setup. Those values are useful evidence that the problem is computationally tractable, but they are not transferable performance expectations for BibleResearch. [NAACL 2025 paper](https://aclanthology.org/2025.naacl-short.13/). Dubremetz and Nivre's chiasmus work is equally important because it shows why surface reversal alone is inadequate. Their 2015 and 2016 papers progressively incorporate contextual and syntactic information into rhetorical-figure detection. For BibleResearch I recommend a two-stage **self-similarity + verification** approach.

For clauses or cola \(c_1,\ldots,c_n\), define:

$$
S_{ij}
=
w_lL_{ij}
+
w_sSem_{ij}
+
w_rRole_{ij}
+
w_pPhon_{ij}
+
w_oOpp_{ij}
$$

A repeated sequence creates a forward diagonal in \(S\); a mirrored structure creates an anti-diagonal.

A chiastic anti-diagonal can be extracted with:

$$
D_{i,j}
=
\max
\left(
0,\,
S_{i,j}
+
D_{i-1,j+1}
-
penalty(i,j)
\right)
$$

This is a **proposed adaptation**, not a result established by the chiasm papers. Its advantage over sliding cosine windows is that it directly models reversed order and permits gaps.

The anti-overfitting criterion should be **Minimum Description Length**:

$$
L(M)+L(D\mid M)
$$

A complex chiastic model should score well only when its structural compression gain exceeds the cost of specifying all its exceptions, skipped clauses, unusual semantic substitutions and arbitrary boundaries. This directly addresses the classic false-positive problem of fitting elaborate symmetry to nearly any sufficiently long passage.

For cadence and structural transitions, **PELT changepoint detection** is a strong offline option. Killick, Fearnhead and Eckley's algorithm minimizes segment cost plus a changepoint penalty and has linear computational cost under the paper's stated conditions. For clause features \(x_i\):

$$
\sum_k
C(x_{\tau_{k-1}+1:\tau_k})
+
\beta m
$$

with features such as clause length, speaker, verb form, MACULA frame, lexical repetition, participant structure and formula membership.

Surprisal complements this:

$$
I(x_i)=-\log_2 P(x_i\mid context)
$$

The system can then distinguish “this clause is unusual relative to the established passage pattern” from “this clause happens to contain a rare word.” Unusual does not imply intentional rhetoric; it is evidence worth investigating.

Hebrew poetic parallelism should likewise be modeled as **alignment of roles and concepts between cola**, not simple verse similarity. Maximum-weight bipartite matching can align corresponding lexical/syntactic units while separately representing identity, synonymy, opposition and completion.

McGovern et al.'s **“Detecting Narrative Patterns in Biblical Hebrew and Greek”** is especially relevant to typology/type-scenes. Their ML4AL 2024 work trains an information-retrieval model using biblical cross-references and reports retrieval of relevant type-scene instances among top-ranked results in several cases. It establishes that cross-reference-supervised representations can expose narrative patterns beyond literal quotation, although supervision leakage must be carefully controlled. [ML4AL 2024 paper](https://aclanthology.org/2024.ml4al-1.26/). T’OMIM is a promising evaluation resource: its 2026 paper describes 554 narrative parallels and 256 poetic parallels in four Apache Parquet datasets under an advertised CC BY 4.0 license. However, its word-level annotations derive from BHSA; that upstream needs an independent license audit before those columns are redistributed under BibleResearch's strict policy. [T’OMIM paper](https://doi.org/10.5334/johd.608); [dataset card](https://huggingface.co/datasets/NuBerea/tomim). All structural discovery channels should be tested against frequency-preserving or genre-preserving null models and corrected for multiple hypothesis testing. Otherwise, corpus-scale pattern search will inevitably surface attractive coincidences.

## Static edge architecture and implementation priorities

Current Cloudflare Workers Free limits are 10 ms CPU per HTTP request, 128 MB isolate memory, 50 subrequests, six simultaneous outgoing connections, 20,000 static assets per Worker version and 25 MiB per individual asset. Cloudflare's current Static Assets documentation also confirms that direct `Range` requests against a static asset return the complete file with `200 OK` rather than ordinary `206 Partial Content`. This means a 20 MiB index shard may satisfy the deployment limit while still being a poor retrieval unit. The best first optimization is therefore not MPH or exotic succinct structures. It is:

**dense verse bitsets + sparse delta postings + binary shards + Block-Max WAND.**

With 31,203 canonical verses, a complete membership bitset requires only:

$$
\left\lceil\frac{31203}{32}\right\rceil 4
=
3904\text{ bytes}.
$$

An AND of two verse predicates therefore touches only 976 `Uint32` words.

FastBitSet.js and TypedFastBitSet.js are both Apache-2.0 and confirm the viability of typed-array bitset operations in JavaScript, though a production BibleResearch index can use an even smaller allocation-free custom kernel. For sparse postings, use sorted integer IDs and delta-varint coding. Roaring is useful conceptually for adaptive sparse/dense containers, but the main official Node implementation uses native bindings, making it less attractive for a pure Worker runtime. Elias–Fano should be a second-stage optimization only after profiling. Minimal perfect hashing is likewise worthwhile only if dictionary lookup is actually significant. PTHash is MIT and academically strong, but its production implementation is C++, not pure TypeScript. The most important ranked-retrieval optimization is **Block-Max WAND**. Ding and Suel's SIGIR 2011 method stores upper score bounds for posting blocks and safely skips blocks that cannot enter the current top-k result set. If:

$$
\sum_{t\in Q}UB_t(block)\le \theta_k,
$$

the block cannot beat the current kth score and need not be fully evaluated.

That should operate only on an additive candidate-generation score—for example rare lemmas, rare pairs, quotation fragments and syntax fingerprints. The existing RRF, PPR and expensive semantic/structural verification then operate on the resulting shortlist.

A reasonable binary layout is:

```text
index/v1/
  dict/
  verse-bitsets/
  postings/lxx-form/
  postings/lxx-lemma/
  postings/lemma-pair/
  align/mt-lxx/
  align/swete-rahlfs/
  syntax/clausefp/
  syntax/eventfp/
  graph/typed-neighbors/
  graph/precomputed-local-ppr/
  rhetoric/structure-candidates/
```

Hot shards should initially be in the rough **64–512 KiB** range, with sizes adjusted from actual access traces rather than targeting Cloudflare's 25 MiB maximum.

A realistic but **unverified** CPU budget to benchmark is:

```text
query normalization          0.25 ms
dictionary routing           0.25 ms
postings/bitset retrieval    0.75 ms
Block-Max WAND               0.90 ms
<=64 candidate verification  1.20 ms
RRF/diversification          0.85 ms
serialization margin         0.50 ms
-----------------------------------
target p50                   4.70 ms
target p95                   <8 ms
hard budget                  <10 ms
```

Those are engineering targets only. The actual repository and Wrangler deployment were unavailable, so no valid runtime benchmark was possible.

The implementation order emerging from the research is clear:

1. **License/provenance gate and LXX foundation:** import only Open Scriptorium's CC BY morphology, build Rahlfs↔Swete token maps, and add field-level transitive provenance.
2. **Independent MT↔LXX alignment:** fast_align forward/reverse + manually annotated stratified evaluation + optional SimAlign comparison.
3. **Static retrieval:** dense bitsets, delta-varint positional postings, bounded binary shards and Block-Max WAND.
4. **Intertextual verification:** rare relational combinations, Smith–Waterman, MACULA structural fingerprints.
5. **Structural discovery:** anti-diagonal recurrence candidates, MDL model selection, PELT/surprisal and parallelism alignment.
6. **Typed semantic graph:** sense-gated OEWN/Wikidata, local PPR, metapaths and existing Steiner explanation.
7. **Evaluation:** hard negatives, null models, held-out benchmarks, ablations, FDR control and Worker p50/p95/p99 measurements.

The strongest overall design is therefore not to replace BibleResearch's current ranking stack with a single neural model. It is to turn the system into a **cascade of independently sourced evidence**:

$$
\text{original text}
\rightarrow
\text{morphology/alignment}
\rightarrow
\text{rare lexical + structural candidates}
\rightarrow
\text{typed semantic/graph expansion}
\rightarrow
\text{bounded verification}
\rightarrow
\text{RRF + diversity}
\rightarrow
\text{source-grounded explanation}.
$$

That architecture addresses precisely where TF-IDF and BFS fail on sparse ancient corpora: translation variation, rare combinations, nonlexical structural reuse, heterogeneous relation types and high-degree semantic hubs—while keeping expensive inference offline and preserving the sub-10-ms edge execution model.

## Source index

The following URLs restore the original research references and the relevant academic foundations. A link to a paper is not a license grant for its software, training data or model weights. Pin versions and verify the actual license files before ingestion.

### Corpora, morphology and alignment

- [Open Scriptorium: First Freely Licensed LXX Morphology](https://openscriptorium.org/posts/free-lxx-morphology) and [dataset repository](https://github.com/OpenScriptorium/lxx-morph).
- [CATSS wrapper and upstream restrictions](https://github.com/curran-gehring/catss/blob/main/README.md).
- [CenterBLC LXX](https://github.com/CenterBLC/LXX), [NuBerea Septuagint](https://huggingface.co/datasets/NuBerea/septuagint-lxx), [NuBerea LXX-WLC bridge](https://huggingface.co/datasets/NuBerea/lxx-wlc-bridge).
- Dyer, Chahuneau and Smith (2013), [A Simple, Fast, and Effective Reparameterization of IBM Model 2](https://aclanthology.org/N13-1073/); [fast_align (Apache-2.0)](https://github.com/clab/fast_align).
- Jalili Sabet et al. (2020), [SimAlign: High Quality Word Alignments Without Parallel Training Data Using Static and Contextualized Embeddings](https://aclanthology.org/2020.findings-emnlp.147/); [MIT license](https://github.com/cisnlp/simalign/blob/master/LICENSE).
- [HELFI](https://github.com/amikael/HELFI), [license manifest](https://github.com/amikael/HELFI/blob/master/LICENSES.md).
- [Clear-Bible Alignments](https://github.com/Clear-Bible/Alignments), [BibleAlignLib license](https://github.com/Clear-Bible/biblealignlib/blob/main/LICENSE.md).
- [STEPBible data and versification](https://github.com/STEPBible/STEPBible-Data).
- [MACULA Greek license](https://github.com/Clear-Bible/macula-greek/blob/main/LICENSE.md); [MACULA Hebrew](https://github.com/Clear-Bible/macula-hebrew).

### Semantics and ontologies

- [UBS open-license collection](https://github.com/ubsicap/ubs-open-license), [Hebrew dictionary](https://devtb.ubsglobal.fyi/tools-resources/ubs-dictionary-of-biblical-hebrew/), [Greek dictionary](https://translation.bible/tools-resources/ubs-dictionary-of-the-greek-new-testament/).
- [Open English WordNet](https://github.com/globalwordnet/english-wordnet), [Wikidata licensing](https://www.wikidata.org/wiki/Wikidata:Licensing), [Wikidata downloads](https://www.wikidata.org/wiki/Wikidata:Database_download).
- [ConceptNet](https://conceptnet.io/), [BabelNet license](https://babelnet.org/license).

### Intertextuality and graph algorithms

- [Tesserae v5](https://github.com/tesserae/tesserae-v5), [Tesserae v6](https://github.com/tesserae/tesserae-v6), [TRACER manual](https://tracer.gitbook.io/manual).
- [The Tesserae Project: intertextual analysis of Latin poetry](https://doi.org/10.1093/llc/fqs033); [Modeling the scholars: Detecting intertextuality through enhanced word-level n-gram matching](https://doi.org/10.1093/llc/fqu014); [The sense of a connection: Automatic tracing of intertextuality by meaning](https://doi.org/10.1093/llc/fqu058).
- Smith and Waterman (1981), [Identification of Common Molecular Subsequences](https://pubmed.ncbi.nlm.nih.gov/7265238/).
- Andersen, Chung and Lang, [Using PageRank to Locally Partition a Graph](https://www.internetmathematicsjournal.com/article/1436-using-pagerank-to-locally-partition-a-graph).
- Sun et al. (2011), [PathSim: Meta Path-Based Top-K Similarity Search in Heterogeneous Information Networks](https://experts.illinois.edu/en/publications/pathsim-meta-path-based-top-k-similarity-search-in-heterogeneous-/).
- Kusner et al. (2015), [From Word Embeddings to Document Distances](https://proceedings.mlr.press/v37/kusnerb15.html).
- Collins and Duffy (2001), [Convolution Kernels for Natural Language](https://papers.neurips.cc/paper_files/paper/2001/hash/bf424cb7b0dea050a42b9739eb261a3a-Abstract.html).

### Literary structure

- McGovern, Sirin and Lippincott (2025), [Computational Discovery of Chiasmus in Ancient Religious Text](https://aclanthology.org/2025.naacl-short.13/).
- Dubremetz and Nivre (2015), [Rhetorical Figure Detection: the Case of Chiasmus](https://aclanthology.org/W15-0703/); (2016), [Syntax Matters for Rhetorical Structure: The Case of Chiasmus](https://aclanthology.org/W16-0206/); (2018), [Rhetorical Figure Detection: Chiasmus, Epanaphora, Epiphora](https://doi.org/10.3389/fdigh.2018.00010).
- Rissanen (1978), [Modeling by Shortest Data Description](https://doi.org/10.1016/0005-1098(78)90005-5).
- Killick, Fearnhead and Eckley (2012), [Optimal Detection of Changepoints With a Linear Computational Cost](https://doi.org/10.1080/01621459.2012.737745).
- McGovern et al. (2024), [Detecting Narrative Patterns in Biblical Hebrew and Greek](https://aclanthology.org/2024.ml4al-1.26/).
- Smiley (2026), [T’OMIM: A Morphologically Annotated Dataset of Parallel Passages in the Hebrew Bible](https://doi.org/10.5334/johd.608), [dataset](https://huggingface.co/datasets/NuBerea/tomim).

### Static edge retrieval

- Cloudflare [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [Static Assets billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).
- [FastBitSet.js](https://github.com/lemire/FastBitSet.js), [TypedFastBitSet.js](https://github.com/lemire/TypedFastBitSet.js), [Roaring bitmap implementations](https://roaringbitmap.org/software/).
- Ottaviano and Venturini (2014), [Partitioned Elias-Fano Indexes](https://doi.org/10.1145/2600428.2609615).
- [PTHash (MIT)](https://github.com/jermp/pthash).
- Ding and Suel (2011), [Faster Top-k Document Retrieval Using Block-Max Indexes](https://dblp.org/rec/conf/sigir/DingS11.html); [paper](https://research.engineering.nyu.edu/~suel/papers/bmw.pdf).
