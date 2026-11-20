// Standard Hebrew Gematria (Mispar Hechrechi / Gadol / Siduri) and
// Greek Isopsephy calculator matching public.calculate_gematria exactly.
// Pure Web/Deno TypeScript with zero Node-only imports.

export type GematriaMethod =
  | 'standard_hebrew_mispar_hechrechi'
  | 'standard_greek_isopsephy'
  | 'mixed_standard'
  | 'none';

export interface GematriaBreakdownItem {
  char: string;
  value: number;
}

export interface GematriaResult {
  input: string;
  spelling_label?: string;
  normalized: string;
  script: 'hebrew' | 'greek' | 'mixed' | 'unknown';
  method: GematriaMethod;
  value: number;
  ordinal_value: number;
  sofit_method?: 'standard_sofit_mispar_gadol';
  sofit_value?: number;
  breakdown?: GematriaBreakdownItem[];
  epistemic_note: 'Arithmetic letter sum for the specified spelling and method only; shared values do not establish etymology or textual equivalence.';
}

const EPISTEMIC_NOTE =
  'Arithmetic letter sum for the specified spelling and method only; shared values do not establish etymology or textual equivalence.' as const;

interface LetterEntry {
  readonly script: 'hebrew' | 'greek';
  readonly value: number;
  readonly ordinal: number;
  readonly sofitValue?: number;
}

const LETTER_TABLE: Readonly<Record<string, LetterEntry>> = {
  // Hebrew consonants (Standard Gematria: sofit forms retain base values)
  'א': { script: 'hebrew', value: 1, ordinal: 1 },
  'ב': { script: 'hebrew', value: 2, ordinal: 2 },
  'ג': { script: 'hebrew', value: 3, ordinal: 3 },
  'ד': { script: 'hebrew', value: 4, ordinal: 4 },
  'ה': { script: 'hebrew', value: 5, ordinal: 5 },
  'ו': { script: 'hebrew', value: 6, ordinal: 6 },
  'ז': { script: 'hebrew', value: 7, ordinal: 7 },
  'ח': { script: 'hebrew', value: 8, ordinal: 8 },
  'ט': { script: 'hebrew', value: 9, ordinal: 9 },
  'י': { script: 'hebrew', value: 10, ordinal: 10 },
  'כ': { script: 'hebrew', value: 20, ordinal: 11 },
  'ך': { script: 'hebrew', value: 20, ordinal: 11, sofitValue: 500 },
  'ל': { script: 'hebrew', value: 30, ordinal: 12 },
  'מ': { script: 'hebrew', value: 40, ordinal: 13 },
  'ם': { script: 'hebrew', value: 40, ordinal: 13, sofitValue: 600 },
  'נ': { script: 'hebrew', value: 50, ordinal: 14 },
  'ן': { script: 'hebrew', value: 50, ordinal: 14, sofitValue: 700 },
  'ס': { script: 'hebrew', value: 60, ordinal: 15 },
  'ע': { script: 'hebrew', value: 70, ordinal: 16 },
  'פ': { script: 'hebrew', value: 80, ordinal: 17 },
  'ף': { script: 'hebrew', value: 80, ordinal: 17, sofitValue: 800 },
  'צ': { script: 'hebrew', value: 90, ordinal: 18 },
  'ץ': { script: 'hebrew', value: 90, ordinal: 18, sofitValue: 900 },
  'ק': { script: 'hebrew', value: 100, ordinal: 19 },
  'ר': { script: 'hebrew', value: 200, ordinal: 20 },
  'ש': { script: 'hebrew', value: 300, ordinal: 21 },
  'ת': { script: 'hebrew', value: 400, ordinal: 22 },

  // Greek letters (Standard Isopsephy)
  'α': { script: 'greek', value: 1, ordinal: 1 },
  'β': { script: 'greek', value: 2, ordinal: 2 },
  'γ': { script: 'greek', value: 3, ordinal: 3 },
  'δ': { script: 'greek', value: 4, ordinal: 4 },
  'ε': { script: 'greek', value: 5, ordinal: 5 },
  'ϛ': { script: 'greek', value: 6, ordinal: 0 },
  'ϝ': { script: 'greek', value: 6, ordinal: 0 },
  'ζ': { script: 'greek', value: 7, ordinal: 6 },
  'η': { script: 'greek', value: 8, ordinal: 7 },
  'θ': { script: 'greek', value: 9, ordinal: 8 },
  'ι': { script: 'greek', value: 10, ordinal: 9 },
  'κ': { script: 'greek', value: 20, ordinal: 10 },
  'λ': { script: 'greek', value: 30, ordinal: 11 },
  'μ': { script: 'greek', value: 40, ordinal: 12 },
  'ν': { script: 'greek', value: 50, ordinal: 13 },
  'ξ': { script: 'greek', value: 60, ordinal: 14 },
  'ο': { script: 'greek', value: 70, ordinal: 15 },
  'π': { script: 'greek', value: 80, ordinal: 16 },
  'ϟ': { script: 'greek', value: 90, ordinal: 0 },
  'ρ': { script: 'greek', value: 100, ordinal: 17 },
  'σ': { script: 'greek', value: 200, ordinal: 18 },
  'ς': { script: 'greek', value: 200, ordinal: 18 },
  'τ': { script: 'greek', value: 300, ordinal: 19 },
  'υ': { script: 'greek', value: 400, ordinal: 20 },
  'φ': { script: 'greek', value: 500, ordinal: 21 },
  'χ': { script: 'greek', value: 600, ordinal: 22 },
  'ψ': { script: 'greek', value: 700, ordinal: 23 },
  'ω': { script: 'greek', value: 800, ordinal: 24 },
  'ϡ': { script: 'greek', value: 900, ordinal: 0 },
};

/**
 * Normalize NFKD and strip Hebrew cantillation/niqqud (\u0591-\u05C7)
 * and combining diacritical marks (\u0300-\u036F) for clean base-letter display.
 */
export function stripScriptMarks(text: string): string {
  if (!text) return '';
  return text.normalize('NFKD').replace(/[\u0591-\u05C7\u0300-\u036F]/g, '');
}

export function computeGematria(script: string, spellingLabel?: string): GematriaResult {
  const normalized = stripScriptMarks(script).toLowerCase();

  let value = 0;
  let sofitValue = 0;
  let ordinalValue = 0;
  let hasSofit = false;
  let hasHebrew = false;
  let hasGreek = false;
  const breakdown: GematriaBreakdownItem[] = [];

  for (const ch of normalized) {
    const entry = LETTER_TABLE[ch];
    if (!entry) continue;

    if (entry.script === 'hebrew') hasHebrew = true;
    else hasGreek = true;

    value += entry.value;
    ordinalValue += entry.ordinal;

    if (entry.sofitValue !== undefined) {
      hasSofit = true;
      sofitValue += entry.sofitValue;
    } else {
      sofitValue += entry.value;
    }

    breakdown.push({ char: ch, value: entry.value });
  }

  const detectedScript: GematriaResult['script'] =
    hasHebrew && hasGreek ? 'mixed' : hasHebrew ? 'hebrew' : hasGreek ? 'greek' : 'unknown';

  const method: GematriaMethod =
    detectedScript === 'hebrew'
      ? 'standard_hebrew_mispar_hechrechi'
      : detectedScript === 'greek'
      ? 'standard_greek_isopsephy'
      : detectedScript === 'mixed'
      ? 'mixed_standard'
      : 'none';

  const result: GematriaResult = {
    input: script,
    normalized,
    script: detectedScript,
    method,
    value,
    ordinal_value: ordinalValue,
    epistemic_note: EPISTEMIC_NOTE,
  };

  if (spellingLabel !== undefined) {
    result.spelling_label = spellingLabel;
  }

  if (hasSofit) {
    result.sofit_method = 'standard_sofit_mispar_gadol';
    result.sofit_value = sofitValue;
  }

  if (breakdown.length > 0) {
    result.breakdown = breakdown;
  }

  return result;
}
