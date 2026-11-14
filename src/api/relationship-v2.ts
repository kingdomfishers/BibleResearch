// @file: src/api/relationship-v2.ts
// @feature: api
// @tables: none
// @candidates: none
// @toc: types:predicates | types:frame | types:relation | registry:v2 | validators:v2

// === @section:types:predicates ===
export type R2PredicateIdV2 =
  | 'grammatical_subject_of'
  | 'grammatical_object_of';

export type PlannedR3PredicateIdV2 =
  | 'grammatical_indirect_object_of'
  | 'grammatical_second_object_of'
  | 'modifies'
  | 'possessive_construction_with'
  | 'grammatical_predicate_of'
  | 'attached_preposition_to';

export type PredicateIdV2 = R2PredicateIdV2 | PlannedR3PredicateIdV2;

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
  phase_status: 'enabled_r2' | 'planned_r3';
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
    minimum_rule_version: '1.0',
    phase_status: 'planned_r3',
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
    minimum_rule_version: '1.0',
    phase_status: 'planned_r3',
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
    minimum_rule_version: '1.0',
    phase_status: 'planned_r3',
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
    minimum_rule_version: '1.0',
    phase_status: 'planned_r3',
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
export function isR2EnabledPredicate(value: string): value is R2PredicateIdV2 {
  const def = (PREDICATE_REGISTRY_V2 as Record<string, PredicateDefinitionV2 | undefined>)[value];
  return Boolean(def && def.phase_status === 'enabled_r2');
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
  if (!isR2EnabledPredicate(relation.predicate)) {
    errors.push(`predicate_not_enabled_for_r2:${relation.predicate}`);
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
      if (!frame.predicate?.token_id || frame.predicate.token_id !== relation.object_token_id) {
        errors.push('object_not_frame_predicate');
      }
    }
  }
  const restricted = findRestrictedFieldKeys(relation);
  if (restricted.length > 0) {
    errors.push(`restricted_fields_present:${restricted.join(',')}`);
  }
  return errors;
}
