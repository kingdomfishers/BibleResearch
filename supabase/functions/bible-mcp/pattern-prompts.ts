// @file: supabase/functions/bible-mcp/pattern-prompts.ts
// @feature: api
// @tables: none
// @candidates: none
// @toc: imports | types | logic:instructions | logic:patterns | logic:prompt

// === @section:imports ===
import { WORKFLOW_INSTRUCTIONS } from './research-workflow.ts';

// === @section:types ===
interface PatternTemplate { title: string; description: string; instruction: string }

// === @section:logic:instructions ===
const evidenceRules = [
  'First resolve explicit passage references and call get_verse_research with p_request.passages (1-5 per call).',
  'For routine exploration select profile="analysis"; for all occurrences, exhaustive evidence or full JSON select profile="full". Explicit occurrence settings always win. Reuse lexical_entries through each word.lexical_entry_key.',
  'For additional candidates use word occurrences, co-occurrences, shared passages, or research_relationships; inspect candidate verses with get_verse_research before citing them.',
  'Read coverage and nested chronology/geography statuses. On packet_limit_exceeded request fewer verses; never silently substitute a sample for complete results.',
  'Base Strong\'s groups inflections and may conflate homographs. Lexeme candidates are not token-sense assignments; cached connections are statistics, not synonyms or proof.',
  'Keep missing semantic domains, unresolved grammar tags, uncertain dates, symbolic places and annotation gaps explicit. English glosses are not a continuous Bible translation.',
  'Separate observed text, linguistic/statistical evidence, reviewed annotations and interpretive hypotheses. Cite book/chapter/verse and word positions for each proposed correspondence.',
  'Seek counterexamples and competing explanations. Do not invent significance tests, numerical probabilities, dates, coordinates, lexical equivalences or numerological proof.',
  'Match the user\'s requested format. Cover observations, candidate_patterns, evidence, counterexamples, alternative_explanations, uncertainty, coverage, and next_checks as relevant; use JSON when requested. Each candidate needs an epistemic_category and a qualitative confidence explanation.',
].join(' ');
const pattern = (title: string, description: string, focus: string): PatternTemplate =>
  ({ title, description, instruction: `${evidenceRules} Research focus: ${focus}` });

// === @section:logic:patterns ===
export const PATTERN_PROMPTS = {
  find_repetition: pattern('Find repetition and inclusions', 'Trace repeated words and clusters in explicit passages.',
    'Compare exact forms, base Strong\'s groups, token positions and grammatical differences. Test clusters and boundary repetitions against nearby context; distinguish translation repetition.'),
  find_literary_structure: pattern('Test literary structure', 'Investigate parallelism, inclusio, and proposed chiasm.',
    'State passage boundaries and proposed segment pairs. Test order, lexical/grammatical correspondences and alternative segmentations. Include mismatches; do not force a chiasm.'),
  trace_motifs: pattern('Trace narrative motifs', 'Compare recurring settings, actions, participants and outcomes.',
    'Track a specific scene sequence across passages, separating shared vocabulary from narrative analogy. Include controls where similar settings lead to different outcomes.'),
  test_intertextuality: pattern('Test quotations and allusions', 'Assess a proposed link between passages.',
    'Compare distinctive word combinations, order, context and supported chronology. Distinguish explicit quotations, textual identification, possible allusion and general resemblance; do not assume Hebrew/Greek equivalence.'),
  compare_semantic_contrasts: pattern('Explore semantic contrasts', 'Investigate contrasts and contextual word meaning.',
    'Use attested renderings, original forms, grammar, occurrences and reviewed evidence. Separate sense candidates from assigned senses and report unavailable semantic-domain annotations.'),
  trace_grammatical_shifts: pattern('Trace grammatical shifts', 'Compare grammatical changes across words and passages.',
    'Examine person, number, gender, tense/aspect, voice and role only when source morphology supports them. Identify the source scheme; report undecoded tags and avoid deriving syntax from glosses.'),
  find_rare_connections: pattern('Explore rare word connections', 'Investigate distinctive combinations and statistical associations.',
    'Compare ranked connections, frequencies, average distances and occurrence denominators. Check passages manually and consider common-word, corpus-size and selection effects. These cached scores are not significance tests.'),
  trace_patterns_in_time_and_place: pattern('Trace patterns through time and place', 'Compare motifs in their supported historical and geographical settings.',
    'Distinguish event setting from composition and audience. Compare chronology models, uncertainty and disputed sites. Do not infer a chronological trend from canonical book order or unresolved dates.'),
  compare_translation_effects: pattern('Compare translation effects', 'Test whether a proposed pattern depends on English renderings.',
    'Preserve ordered original tokens and occurrence-specific source glosses. Compare available renderings and homographs. Explain which correspondences survive translation choices and which remain uncertain.'),
  challenge_pattern: pattern('Challenge a proposed pattern', 'Find counterexamples and alternatives to a supplied pattern claim.',
    'State a falsifiable claim and search for failures, controls, boundary changes and alternative explanations. Report both support and contradictions; missing annotations do not prove absence.'),
} as const;
export type PatternName = keyof typeof PATTERN_PROMPTS;

// === @section:logic:prompt ===
export function patternPrompt(name: PatternName, subject: string): string {
  return `${WORKFLOW_INSTRUCTIONS}\n${PATTERN_PROMPTS[name].instruction}\nResearch subject: ${JSON.stringify(subject)}`;
}
