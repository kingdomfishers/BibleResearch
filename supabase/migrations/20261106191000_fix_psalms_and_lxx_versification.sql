-- ============================================================================
-- Migration: 20261106191000_fix_psalms_and_lxx_versification.sql
-- Description: Correct Psalm versification mappings, resolve conflicting title
--              shifts on Psalms without titles (Ps 1 & 2), map Psalm 23
--              correctly to LXX Swete 22 (MT 23:1 -> LXX 22:1), correct
--              Psalm 51 (2-verse title shift: MT 51:1 -> LXX 50:3), correct
--              Psalm 119 (1:1 match to LXX 118:1..176, no title), and properly
--              classify unmapped / omitted Hebrew verses as unmatched_hebrew.
-- ============================================================================

-- 1. Supersede conflicting duplicate title shifts on Psalms 1 and 2
UPDATE public.hebrew_lxx_verse_map
SET lxx_book_no = NULL,
    lxx_chapter = NULL,
    lxx_verse_nr = NULL,
    mapping_kind = 'unmatched_hebrew',
    rule_citation = 'Superseded duplicate title shift on Psalm without superscription.'
WHERE canonical_verse_id IN (
  SELECT id FROM public.verses WHERE book = 19 AND chapter IN (1, 2)
)
AND mapping_kind = 'psalms_title_shift';

-- 2. Correct Psalm 23 mappings to LXX Swete 22
-- In Swete's Septuagint, LXX 22:1 is the text ("Κύριος ποιμαίνει με"),
-- while the title ("Ψαλμὸς τῷ Δαυείδ") is placed at the end as verse 32 (subscription).
UPDATE public.hebrew_lxx_verse_map
SET lxx_verse_nr = 32,
    mapping_kind = 'superscription_title_verse',
    rule_citation = 'Psalms MT 23:0 (superscription) -> LXX Swete 22:32 (subscription title verse).'
WHERE canonical_verse_id = (SELECT id FROM public.verses WHERE book = 19 AND chapter = 23 AND verse_nr = 0)
  AND lxx_book_no = 27
  AND lxx_chapter = 22;

UPDATE public.hebrew_lxx_verse_map
SET lxx_verse_nr = 1,
    rule_citation = 'Psalms MT 23:1 -> LXX Swete 22:1 (Κύριος ποιμαίνει με).'
WHERE canonical_verse_id = (SELECT id FROM public.verses WHERE book = 19 AND chapter = 23 AND verse_nr = 1)
  AND lxx_book_no = 27
  AND lxx_chapter = 22;

UPDATE public.hebrew_lxx_verse_map
SET lxx_verse_nr = 2,
    rule_citation = 'Psalms MT 23:2 -> LXX Swete 22:2 (εἰς τόπον χλόης).'
WHERE canonical_verse_id = (SELECT id FROM public.verses WHERE book = 19 AND chapter = 23 AND verse_nr = 2)
  AND lxx_book_no = 27
  AND lxx_chapter = 22;

UPDATE public.hebrew_lxx_verse_map
SET lxx_verse_nr = 3,
    rule_citation = 'Psalms MT 23:3 -> LXX Swete 22:3 (τὴν ψυχήν μου ἐπέστρεψεν).'
WHERE canonical_verse_id = (SELECT id FROM public.verses WHERE book = 19 AND chapter = 23 AND verse_nr = 3)
  AND lxx_book_no = 27
  AND lxx_chapter = 22;

UPDATE public.hebrew_lxx_verse_map
SET lxx_verse_nr = 4,
    rule_citation = 'Psalms MT 23:4 -> LXX Swete 22:4 (ἐὰν γὰρ καὶ πορευθῶ).'
WHERE canonical_verse_id = (SELECT id FROM public.verses WHERE book = 19 AND chapter = 23 AND verse_nr = 4)
  AND lxx_book_no = 27
  AND lxx_chapter = 22;

UPDATE public.hebrew_lxx_verse_map
SET lxx_verse_nr = 5,
    rule_citation = 'Psalms MT 23:5 -> LXX Swete 22:5 (ἡτοίμασας ἐνώπιόν μου).'
WHERE canonical_verse_id = (SELECT id FROM public.verses WHERE book = 19 AND chapter = 23 AND verse_nr = 5)
  AND lxx_book_no = 27
  AND lxx_chapter = 22;

UPDATE public.hebrew_lxx_verse_map
SET lxx_verse_nr = 6,
    rule_citation = 'Psalms MT 23:6 -> LXX Swete 22:6 (καὶ τὸ ἔλεός σου καταδιώξεταί με).'
WHERE canonical_verse_id = (SELECT id FROM public.verses WHERE book = 19 AND chapter = 23 AND verse_nr = 6)
  AND lxx_book_no = 27
  AND lxx_chapter = 22;

-- 3. Correct Psalm 51 mappings: 2-verse title shift (MT 51:1..19 -> LXX Swete 50:3..21)
UPDATE public.hebrew_lxx_verse_map m
SET lxx_book_no = 27,
    lxx_chapter = 50,
    lxx_verse_nr = v.verse_nr + 2,
    mapping_kind = 'psalm_numbering_shift',
    rule_citation = 'Psalms MT 51:' || v.verse_nr || ' -> LXX Swete 50:' || (v.verse_nr + 2) || ' (2-verse title shift).'
FROM public.verses v
WHERE v.id = m.canonical_verse_id
  AND v.book = 19
  AND v.chapter = 51
  AND v.verse_nr >= 1;

-- 4. Correct Psalm 119 mappings: 1:1 match to LXX Swete 118 (no title, verses 1..176)
UPDATE public.hebrew_lxx_verse_map m
SET lxx_book_no = 27,
    lxx_chapter = 118,
    lxx_verse_nr = v.verse_nr,
    mapping_kind = 'psalm_numbering_shift',
    rule_citation = 'Psalms MT 119:' || v.verse_nr || ' -> LXX Swete 118:' || v.verse_nr || ' (1:1 verse match, no title).'
FROM public.verses v
WHERE v.id = m.canonical_verse_id
  AND v.book = 19
  AND v.chapter = 119;

-- 5. Reclassify all Hebrew verses where corresponding LXX verse does not exist in Swete
UPDATE public.hebrew_lxx_verse_map m
SET mapping_kind = 'unmatched_hebrew',
    lxx_book_no = NULL,
    lxx_chapter = NULL,
    lxx_verse_nr = NULL,
    rule_citation = coalesce(rule_citation, '') || ' [No corresponding LXX verse in Swete chapter due to versification boundary differences]'
WHERE m.lxx_book_no IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.lxx_swete_words w
      WHERE w.book_no = m.lxx_book_no
        AND w.chapter = m.lxx_chapter
        AND w.verse_nr = m.lxx_verse_nr
  );
