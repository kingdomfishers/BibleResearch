// @file: src/api/relationship-v2.ts
// @feature: api
// @tables: none
// @candidates: none
// @toc: types:predicates | types:frame | types:relation | registry:v2 | validators:v2

// === @section:types:predicates ===
export type R2PredicateIdV2 =
  | 'grammatical_subject_of'
  | 'grammatical_object_of';

export type R3EnabledPredicateIdV2 =
  | 'grammatical_indirect_object_of'
  | 'grammatical_second_object_of'
  | 'modifies'
  | 'possessive_construction_with';

export type EnabledPredicateIdV2 = R2PredicateIdV2 | R3EnabledPredicateIdV2;

export type PlannedR3PredicateIdV2 =
  | R3EnabledPredicateIdV2
  | 'grammatical_predicate_of'
  | 'attached_preposition_to';

export type PredicateIdV2 = R2PredicateIdV2 | PlannedR3PredicateIdV2;

export type PredicateStatusV2 =
  | 'enabled_r2'
  | 'enabled_r3'
  | 'planned_r3'
  | 'planned_r4';

export type RelationshipPredicateIdV2 = PredicateIdV2;
export type SourceEditionIdV2 = string;
export type SourceLanguageV2 = 'hebrew' | 'greek';

export type ExtractionQualityV2 =
  | 'source_explicit'
  | 'rule_derived'
  | 'candidate';

export type FrameQualityV2 = ExtractionQualityV2 | 'not_covered';

export type AlignmentStatusV2 =
  | 'native_source'
  | 'versification_shifted'
  | 'not_in_canonical_verse'
  | 'not_covered';

export type FrameRoleNameV2 =
  | 'grammatical_subject'
  | 'grammatical_object'
  | 'grammatical_indirect_object'
  | 'grammatical_second_object'
  | 'copular_verb'
  | 'nonverbal_predicate';

export type FrameRoleStateV2 =
  | 'explicit'
  | 'candidate'
  | 'clausal'
  | 'unresolved'
  | 'skipped';

export interface PredicateDefinitionV2 {
  id: PredicateIdV2;
  lane: 'grammatical';
  description: string;
  from_kinds: readonly ['token_occurrence'];
  to_kinds: readonly ['token_occurrence'];
  direction: 'directed';
  inverse_label: string;
  evidence_requirements: readonly string[];
  aggregation: 'lemma_pair_with_qualifiers';
  default_quality: ExtractionQualityV2;
  transitive: false;
  eligible_for_cross_claim_inference: false;
  minimum_rule_version: string;
  phase_status: PredicateStatusV2;
}

// === @section:types:frame ===
export interface GrammaticalFrameSourceV2 {
  edition: string;
  source_release: string;
  source_file: string;
  clause_node_id: string;
  reference: string;
  canonical_verse_ids: string[];
  alignment_status: AlignmentStatusV2;
}

export interface GrammaticalFramePredicateV2 {
  token_id: string | null;
  lemma_id: string | null;
  source_form: string | null;
}

export interface GrammaticalFrameRoleV2 {
  role: FrameRoleNameV2;
  head_token_id: string | null;
  lemma_id: string | null;
  source_phrase_id: string | null;
  state: FrameRoleStateV2;
  head_resolution?: string;
  reason?: string;
}

export interface GrammaticalFrameContextV2 {
  polarity: 'affirmative_candidate' | 'negative' | 'uncertain' | 'unknown';
  modality:
    | 'indicative'
    | 'imperative'
    | 'jussive'
    | 'cohortative'
    | 'subjunctive'
    | 'optative'
    | 'infinitive'
    | 'participle'
    | 'interrogative'
    | 'unknown';
  voice: 'active' | 'passive' | 'middle' | 'middlepassive' | 'unknown';
  speaker_scope: 'narrator_candidate' | 'quoted_speaker' | 'unknown';
  quotation: 'none' | 'direct_speech_turn' | 'nested_speech_object' | 'unknown';
  figurative_scope: 'literal_candidate' | 'unknown';
}

export interface GrammaticalFrameExtractionV2 {
  algorithm: string;
  rule_version: string;
  quality: FrameQualityV2;
  warnings: string[];
}

export interface GrammaticalFrameV2 {
  frame_id: string;
  schema_version: '2.0';
  source: GrammaticalFrameSourceV2;
  predicate: GrammaticalFramePredicateV2 | null;
  roles: GrammaticalFrameRoleV2[];
  context: GrammaticalFrameContextV2;
  extraction: GrammaticalFrameExtractionV2;
}

// === @section:types:relation ===
export interface OccurrenceRelationEvidenceV2 {
  edition: string;
  reference: string;
  source_clause_id: string;
  rule_id: string;
}

export interface OccurrenceRelationQualifiersV2 {
  polarity: GrammaticalFrameContextV2['polarity'];
  modality: GrammaticalFrameContextV2['modality'];
  voice: GrammaticalFrameContextV2['voice'];
  quotation: GrammaticalFrameContextV2['quotation'];
}

export interface OccurrenceRelationV2 {
  relation_id: string;
  frame_id: string;
  subject_token_id: string;
  subject_lemma_id: string;
  predicate: PredicateIdV2;
  object_token_id: string;
  object_lemma_id: string;
  evidence: OccurrenceRelationEvidenceV2;
  quality: ExtractionQualityV2;
  qualifiers: OccurrenceRelationQualifiersV2;
}

export interface RelationSummaryStatsV2 {
  distinct_frames: number;
  occurrences: number;
  distinct_passages: number;
  distinct_books: number;
  source_explicit: number;
  rule_derived: number;
  candidate: number;
  negated_or_uncertain: number;
  command_or_prediction: number;
  clauses_eligible: number;
  clauses_processed: number;
}

export interface RelationSummaryV2 {
  summary_id: string;
  lane: 'grammatical';
  from_lemma_id: string;
  predicate: RelationshipPredicateIdV2;
  inverse_predicate: string;
  to_lemma_id: string;
  quality_tier: 'high_quality' | 'candidate_only';
  source_edition: SourceEditionIdV2;
  language: SourceLanguageV2;
  rule_version: string;
  stats: RelationSummaryStatsV2;
  sample_passages: string[];
  evidence_ids: string[];
}

export interface LexicalLaneRecordV2 {
  lane: 'lexical';
  lemma_id: string;
  lexeme_id: string | null;
  strongs_base: string | null;
  lemma_form: string | null;
  root_links: Array<Record<string, unknown>>;
  lexical_formations: Array<Record<string, unknown>>;
  lexical_connections: Array<Record<string, unknown>>;
  canonical_entity_links: Array<Record<string, unknown>>;
}

export interface ContextualCooccurrenceSummaryV2 {
  lane: 'contextual';
  nature: 'statistical_co_occurrence_not_grammatical_relation';
  same_verse_co_occurrences_sample_count: number;
  distinct_co_occurring_strongs: string[];
}

export interface EvidenceIndexEntryV2 {
  relation_id: string;
  frame_id: string;
  clause_node_id: string;
  canonical_ref: string;
  source_edition: SourceEditionIdV2;
  language: SourceLanguageV2;
  summary_id: string | null;
  inverse_summary_id: string | null;
  relation: OccurrenceRelationV2;
}

export interface GraphManifestV2 {
  schema_version: '2.0';
  rule_version: string;
  generated_at: string;
  artifact_root: string;
  files: Record<string, { path: string; sha256: string; bytes: number }>;
  counts: Record<string, unknown>;
}

// === @section:registry:v2 ===
export const RESTRICTED_SOURCE_FIELDS: readonly string[] = [
  'sdbh',
  'lexdomain',
  'coredomain',
  'contextualdomain',
  'domain',
  'ln',
  'frame',
  'semantic_frame',
  'meaning',
];

export const PREDICATE_REGISTRY_V2: Record<PredicateIdV2, PredicateDefinitionV2> = {
  grammatical_subject_of: {
    id: 'grammatical_subject_of',
    lane: 'grammatical',
    description:
      'Source occurrence is grammatical subject of predicate occurrence in a specific clause',
    from_kinds: ['token_occurrence'],
    to_kinds: ['token_occurrence'],
    direction: 'directed',
    inverse_label: 'has_grammatical_subject',
    evidence_requirements: ['source_clause', 'role_annotation', 'source_token_links'],
    aggregation: 'lemma_pair_with_qualifiers',
    default_quality: 'candidate',
    transitive: false,
    eligible_for_cross_claim_inference: false,
    minimum_rule_version: '1.0',
    phase_status: 'enabled_r2',
  },
  grammatical_object_of: {
    id: 'grammatical_object_of',
    lane: 'grammatical',
    description:
      'Source occurrence is grammatical direct object of predicate occurrence in a specific clause',
    from_kinds: ['token_occurrence'],
    to_kinds: ['token_occurrence'],
    direction: 'directed',
    inverse_label: 'has_grammatical_object',
    evidence_requirements: ['source_clause', 'role_annotation', 'source_token_links'],
    aggregation: 'lemma_pair_with_qualifiers',
    default_quality: 'candidate',
    transitive: false,
    eligible_for_cross_claim_inference: false,
    minimum_rule_version: '1.0',
    phase_status: 'enabled_r2',
  },
  grammatical_indirect_object_of: {
    id: 'grammatical_indirect_object_of',
    lane: 'grammatical',
    description:
      'Source occurrence is grammatical indirect object of predicate occurrence in a specific clause',
    from_kinds: ['token_occurrence'],
    to_kinds: ['token_occurrence'],
    direction: 'directed',
    inverse_label: 'has_grammatical_indirect_object',
    evidence_requirements: ['source_clause', 'role_annotation', 'source_token_links'],
    aggregation: 'lemma_pair_with_qualifiers',
    default_quality: 'candidate',
    transitive: false,
    eligible_for_cross_claim_inference: false,
    minimum_rule_version: '1.2',
    phase_status: 'enabled_r3',
  },
  grammatical_second_object_of: {
    id: 'grammatical_second_object_of',
    lane: 'grammatical',
    description:
      'Source occurrence is second object or complement of predicate occurrence in a specific clause',
    from_kinds: ['token_occurrence'],
    to_kinds: ['token_occurrence'],
    direction: 'directed',
    inverse_label: 'has_grammatical_second_object',
    evidence_requirements: ['source_clause', 'role_annotation', 'source_token_links'],
    aggregation: 'lemma_pair_with_qualifiers',
    default_quality: 'candidate',
    transitive: false,
    eligible_for_cross_claim_inference: false,
    minimum_rule_version: '1.2',
    phase_status: 'enabled_r3',
  },
  modifies: {
    id: 'modifies',
    lane: 'grammatical',
    description: 'Modifier occurrence attaches to nominal or phrase head occurrence',
    from_kinds: ['token_occurrence'],
    to_kinds: ['token_occurrence'],
    direction: 'directed',
    inverse_label: 'modified_by',
    evidence_requirements: ['source_clause', 'phrase_head_rule', 'source_token_links'],
    aggregation: 'lemma_pair_with_qualifiers',
    default_quality: 'candidate',
    transitive: false,
    eligible_for_cross_claim_inference: false,
    minimum_rule_version: '1.2',
    phase_status: 'enabled_r3',
  },
  possessive_construction_with: {
    id: 'possessive_construction_with',
    lane: 'grammatical',
    description:
      'Construct-chain or genitive expression grammatically links to possessed or head occurrence',
    from_kinds: ['token_occurrence'],
    to_kinds: ['token_occurrence'],
    direction: 'directed',
    inverse_label: 'has_possessive_construction',
    evidence_requirements: ['source_clause', 'construct_or_genitive_rule', 'source_token_links'],
    aggregation: 'lemma_pair_with_qualifiers',
    default_quality: 'candidate',
    transitive: false,
    eligible_for_cross_claim_inference: false,
    minimum_rule_version: '1.2',
    phase_status: 'enabled_r3',
  },
  grammatical_predicate_of: {
    id: 'grammatical_predicate_of',
    lane: 'grammatical',
    description:
      'Predicate nominal or adjective stands in copular or verbless predication of subject',
    from_kinds: ['token_occurrence'],
    to_kinds: ['token_occurrence'],
    direction: 'directed',
    inverse_label: 'has_grammatical_predicate',
    evidence_requirements: ['source_clause', 'copular_or_verbless_role', 'source_token_links'],
    aggregation: 'lemma_pair_with_qualifiers',
    default_quality: 'candidate',
    transitive: false,
    eligible_for_cross_claim_inference: false,
    minimum_rule_version: '1.0',
    phase_status: 'planned_r3',
  },
  attached_preposition_to: {
    id: 'attached_preposition_to',
    lane: 'grammatical',
    description: 'Prepositional phrase attaches syntactically to head or predicate occurrence',
    from_kinds: ['token_occurrence'],
    to_kinds: ['token_occurrence'],
    direction: 'directed',
    inverse_label: 'has_attached_preposition',
    evidence_requirements: ['source_clause', 'phrase_attachment', 'source_token_links'],
    aggregation: 'lemma_pair_with_qualifiers',
    default_quality: 'candidate',
    transitive: false,
    eligible_for_cross_claim_inference: false,
    minimum_rule_version: '1.0',
    phase_status: 'planned_r3',
  },
};

// === @section:validators:v2 ===
export const VERBAL_CLAUSE_ARGUMENT_PREDICATES: readonly EnabledPredicateIdV2[] = [
  'grammatical_subject_of',
  'grammatical_object_of',
  'grammatical_indirect_object_of',
  'grammatical_second_object_of',
];

export const PHRASE_INTERNAL_PREDICATES: readonly R3EnabledPredicateIdV2[] = [
  'modifies',
  'possessive_construction_with',
];

export function isR2EnabledPredicate(value: string): value is R2PredicateIdV2 {
  const def = (PREDICATE_REGISTRY_V2 as Record<string, PredicateDefinitionV2 | undefined>)[value];
  return Boolean(def && def.phase_status === 'enabled_r2');
}

export function isEnabledPredicateV2(value: string): value is EnabledPredicateIdV2 {
  const def = (PREDICATE_REGISTRY_V2 as Record<string, PredicateDefinitionV2 | undefined>)[value];
  return Boolean(def && (def.phase_status === 'enabled_r2' || def.phase_status === 'enabled_r3'));
}

export function findRestrictedFieldKeys(value: unknown, path = ''): string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      found.push(...findRestrictedFieldKeys(value[i], `${path}[${i}]`));
    }
    return found;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (RESTRICTED_SOURCE_FIELDS.includes(key.toLowerCase())) {
        found.push(nextPath);
      }
      found.push(...findRestrictedFieldKeys(nested, nextPath));
    }
  }
  return found;
}

export function validateGrammaticalFrameV2(frame: GrammaticalFrameV2): string[] {
  const errors: string[] = [];
  if (!frame.frame_id) errors.push('missing_frame_id');
  if (frame.schema_version !== '2.0') errors.push('invalid_schema_version');
  if (!frame.source?.edition || !frame.source?.clause_node_id) {
    errors.push('missing_source_clause_identity');
  }
  if (!Array.isArray(frame.source?.canonical_verse_ids)) {
    errors.push('canonical_verse_ids_not_array');
  }
  if (!Array.isArray(frame.roles)) {
    errors.push('roles_not_array');
  }
  if (!frame.context || !frame.context.polarity || !frame.context.modality || !frame.context.voice) {
    errors.push('missing_context_qualifiers');
  }
  if (!frame.extraction?.algorithm || !frame.extraction?.rule_version) {
    errors.push('missing_extraction_metadata');
  }
  const restricted = findRestrictedFieldKeys(frame);
  if (restricted.length > 0) {
    errors.push(`restricted_fields_present:${restricted.join(',')}`);
  }
  return errors;
}

export function validateOccurrenceRelationV2(
  relation: OccurrenceRelationV2,
  frameById?: Map<string, GrammaticalFrameV2>,
): string[] {
  const errors: string[] = [];
  if (!relation.relation_id) errors.push('missing_relation_id');
  if (!relation.frame_id) errors.push('missing_frame_id');
  if (!isEnabledPredicateV2(relation.predicate)) {
    errors.push(`predicate_not_enabled:${relation.predicate}`);
  }
  if (!relation.subject_token_id || !relation.subject_lemma_id) {
    errors.push('missing_subject_identity');
  }
  if (!relation.object_token_id || !relation.object_lemma_id) {
    errors.push('missing_object_identity');
  }
  if (!relation.evidence?.edition || !relation.evidence?.source_clause_id || !relation.evidence?.rule_id) {
    errors.push('missing_evidence_provenance');
  }
  const isPhraseInternal = (PHRASE_INTERNAL_PREDICATES as readonly string[]).includes(relation.predicate);
  if (isPhraseInternal && relation.subject_token_id && relation.subject_token_id === relation.object_token_id) {
    errors.push('self_loop_phrase_relation');
  }
  if (frameById) {
    const frame = frameById.get(relation.frame_id);
    if (!frame) {
      errors.push('orphan_frame_id');
    } else {
      if (frame.source.edition !== relation.evidence.edition) {
        errors.push('cross_edition_mismatch');
      }
      if (frame.source.clause_node_id !== relation.evidence.source_clause_id) {
        errors.push('cross_clause_mismatch');
      }
      if (!isPhraseInternal) {
        if (!frame.predicate?.token_id || frame.predicate.token_id !== relation.object_token_id) {
          errors.push('object_not_frame_predicate');
        }
        const hasRoleToken = frame.roles.some((r) => r.head_token_id === relation.subject_token_id);
        if (!hasRoleToken) {
          errors.push('subject_not_in_frame_roles');
        }
      }
    }
  }
  const restricted = findRestrictedFieldKeys(relation);
  if (restricted.length > 0) {
    errors.push(`restricted_fields_present:${restricted.join(',')}`);
  }
  return errors;
}

export function validateRelationSummaryV2(
  summary: RelationSummaryV2,
  relationsById?: Map<string, OccurrenceRelationV2>,
): string[] {
  const errors: string[] = [];
  if (!summary.summary_id) errors.push('missing_summary_id');
  if (summary.lane !== 'grammatical') errors.push('invalid_summary_lane');
  if (!summary.from_lemma_id || !summary.to_lemma_id) errors.push('missing_lemma_pair');
  if (!isEnabledPredicateV2(summary.predicate)) {
    errors.push(`predicate_not_enabled:${summary.predicate}`);
  } else {
    const expectedInverse = PREDICATE_REGISTRY_V2[summary.predicate].inverse_label;
    if (summary.inverse_predicate !== expectedInverse) {
      errors.push(`inverse_predicate_mismatch:${summary.inverse_predicate}!=${expectedInverse}`);
    }
  }
  if (!summary.source_edition || !summary.language || !summary.rule_version) {
    errors.push('missing_edition_or_rule_version');
  }
  if (!Array.isArray(summary.evidence_ids) || summary.evidence_ids.length === 0) {
    errors.push('missing_evidence_ids');
  }
  const s = summary.stats;
  if (!s) {
    errors.push('missing_stats');
  } else if (summary.quality_tier === 'high_quality') {
    if (s.candidate !== 0) errors.push('high_quality_summary_contains_candidates');
    if (s.occurrences !== s.source_explicit + s.rule_derived) {
      errors.push('high_quality_occurrence_count_mismatch');
    }
    if (Array.isArray(summary.evidence_ids) && s.occurrences !== summary.evidence_ids.length) {
      errors.push('high_quality_evidence_count_mismatch');
    }
  } else if (summary.quality_tier === 'candidate_only') {
    if (s.source_explicit !== 0 || s.rule_derived !== 0 || s.occurrences !== 0) {
      errors.push('candidate_summary_pollutes_high_quality_counts');
    }
    if (Array.isArray(summary.evidence_ids) && s.candidate !== summary.evidence_ids.length) {
      errors.push('candidate_evidence_count_mismatch');
    }
  } else {
    errors.push(`invalid_quality_tier:${String(summary.quality_tier)}`);
  }

  if (relationsById && Array.isArray(summary.evidence_ids)) {
    for (const eid of summary.evidence_ids) {
      const rel = relationsById.get(eid);
      if (!rel) {
        errors.push(`orphan_evidence_id:${eid}`);
        continue;
      }
      if (
        rel.subject_lemma_id !== summary.from_lemma_id ||
        rel.predicate !== summary.predicate ||
        rel.object_lemma_id !== summary.to_lemma_id ||
        rel.evidence.edition !== summary.source_edition
      ) {
        errors.push(`evidence_mismatch:${eid}`);
      }
      const expectedTier = rel.quality === 'candidate' ? 'candidate_only' : 'high_quality';
      if (expectedTier !== summary.quality_tier) {
        errors.push(`quality_tier_mismatch:${eid}`);
      }
    }
  }

  const restricted = findRestrictedFieldKeys(summary);
  if (restricted.length > 0) {
    errors.push(`restricted_fields_present:${restricted.join(',')}`);
  }
  return errors;
}
