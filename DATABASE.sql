-- 1. WORDS TABLE
CREATE TABLE public.words (
    id INT4 PRIMARY KEY,                        -- Sequential 1..N (Memory optimized)
    strongs_nr VARCHAR(10) NOT NULL,            -- e.g., 'H7225', 'G3056'
    grammar_code VARCHAR(30),                   -- Morphology code
    original_word TEXT NOT NULL,                -- Hebrew / Greek script
    transliteration TEXT NOT NULL,              -- Phonetic Latin script
    co_occurrences JSONB DEFAULT '[]'::jsonb,   -- [{ "word_id": 45, "score": 0.92, "freq": 14, "avg_dist": 2.1 }]
    biblical_def TEXT,
    physical_def TEXT,
    english_translations TEXT[] DEFAULT '{}'    -- Ordered by frequency
);

CREATE INDEX idx_words_strongs ON public.words(strongs_nr);
CREATE INDEX idx_words_translit ON public.words(transliteration);
CREATE INDEX idx_words_original ON public.words(original_word);

-- 2. VERSES TABLE
CREATE TABLE public.verses (
    id SERIAL PRIMARY KEY,
    book SMALLINT NOT NULL,                     -- 1 to 66
    chapter SMALLINT NOT NULL,
    verse_nr SMALLINT NOT NULL,
    word_ids INT4[] NOT NULL,                   -- Ordered array of words.id
    millennium SMALLINT CHECK (millennium BETWEEN 1 AND 7),
    UNIQUE (book, chapter, verse_nr)
);

-- GIN Index for sub-millisecond array containment (@>) lookups
CREATE INDEX idx_verses_word_ids_gin ON public.verses USING GIN (word_ids);
CREATE INDEX idx_verses_reference ON public.verses (book, chapter, verse_nr);

-- 3. ROW LEVEL SECURITY (Public Read-Only for UI & AI Plugins)
ALTER TABLE public.words ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on words" ON public.words FOR SELECT USING (true);
CREATE POLICY "Allow public read on verses" ON public.verses FOR SELECT USING (true);



-- HELPER: Resolve a text query (Strong's, Original, Transliteration, or ID) to word_id
CREATE OR REPLACE FUNCTION resolve_word_id(p_query TEXT)
RETURNS INT4 LANGUAGE sql STABLE AS $$
    SELECT id FROM public.words
    WHERE (p_query ~ '^\d+$' AND id = p_query::INT4) OR strongs_nr ILIKE p_query OR original_word = p_query OR transliteration ILIKE p_query LIMIT 1; $$;

-- PROMPT 1: Lookup which words a verse has (Ordered & Hydrated)
CREATE OR REPLACE FUNCTION prompt_verse_words(p_book SMALLINT, p_chapter SMALLINT, p_verse SMALLINT)
RETURNS TABLE (
    position INT4,
    word_id INT4,
    original_word TEXT,
    transliteration TEXT,
    strongs_nr VARCHAR(10),
    grammar_code VARCHAR(30),
    primary_english TEXT,
    millennium SMALLINT
) LANGUAGE sql STABLE AS $$ SELECT u.ord::INT4 AS position, w.id AS word_id, w.original_word, w.transliteration, w.strongs_nr, w.grammar_code, w.english_translations[1] AS primary_english, v.millennium FROM public.verses v CROSS JOIN LATERAL unnest(v.word_ids) WITH ORDINALITY AS u(w_id, ord) JOIN public.words w ON w.id = u.w_id WHERE v.book = p_book AND v.chapter = p_chapter AND v.verse_nr = p_verse ORDER BY u.ord ASC; $$;

-- PROMPT 2: Look up where in the Bible a certain word can be found
-- Accepts either word_id (as text, e.g. '45') OR Strong's/Transliteration/Original (for AI plugins)
CREATE OR REPLACE FUNCTION prompt_word_occurrences(p_word_query TEXT)
RETURNS TABLE (
    book SMALLINT,
    chapter SMALLINT,
    verse_nr SMALLINT,
    millennium SMALLINT,
    occurrence_count INT4
) LANGUAGE sql STABLE AS $$ WITH target AS ( SELECT resolve_word_id(p_word_query) AS id ) SELECT v.book, v.chapter, v.verse_nr, v.millennium, -- Count how many times the word appears inside that specific verse (SELECT count(*)::INT4 FROM unnest(v.word_ids) AS wid WHERE wid = target.id) AS occurrence_count FROM public.verses v, target WHERE target.id IS NOT NULL AND v.word_ids @> ARRAY[target.id] ORDER BY v.book, v.chapter, v.verse_nr; $$;

-- PROMPT 3: Look up what words frequently come together with a word (Hydrated in 1 query)
CREATE OR REPLACE FUNCTION prompt_word_cooccurrences(p_word_query TEXT)
RETURNS TABLE (
    word_id INT4,
    strongs_nr VARCHAR(10),
    original_word TEXT,
    transliteration TEXT,
    primary_english TEXT,
    score NUMERIC,
    frequency INT4,
    avg_distance NUMERIC
) LANGUAGE sql STABLE AS $$ WITH target AS ( SELECT co_occurrences FROM public.words WHERE id = resolve_word_id(p_word_query) ) SELECT w.id AS word_id, w.strongs_nr, w.original_word, w.transliteration, w.english_translations[1] AS primary_english, (c.value->>'score')::NUMERIC AS score, (c.value->>'freq')::INT4 AS frequency, (c.value->>'avg_dist')::NUMERIC AS avg_distance FROM target t CROSS JOIN LATERAL jsonb_array_elements(t.co_occurrences) AS c(value) JOIN public.words w ON w.id = (c.value->>'word_id')::INT4 ORDER BY score DESC; $$;

-- PROMPT 4: Find word relationships (Passages where an array of words occur together + score)
CREATE OR REPLACE FUNCTION prompt_word_relationships(p_word_ids INT4[])
RETURNS TABLE (
    book SMALLINT,
    chapter SMALLINT,
    verse_nr SMALLINT,
    millennium SMALLINT,
    relationship_score NUMERIC
) LANGUAGE sql STABLE AS $$ SELECT v.book, v.chapter, v.verse_nr, v.millennium, -- Proximity & density score calculated directly in SQL ROUND( (cardinality(p_word_ids)::NUMERIC / GREATEST(cardinality(v.word_ids), 1)::NUMERIC) * 100, 2 ) AS relationship_score FROM public.verses v WHERE v.word_ids @> p_word_ids ORDER BY relationship_score DESC, v.book, v.chapter, v.verse_nr; $$;