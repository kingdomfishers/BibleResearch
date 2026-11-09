if (!globalThis.__mockRpcState) {
  globalThis.__mockRpcState = {
    connectionTypesResponse: {
      note_kinds: [
        { note_kind: 'study', label: 'Study' },
        { note_kind: 'translation_note', label: 'Translation' },
        { note_kind: 'exegetical', label: 'Exegetical' },
      ],
      connection_types: [
        { connection_type: 'contained_in', type_key: 'contained_in', label: 'is contained in', inverse_label: 'contains', category: 'linguistic', default_direction: 'directed', is_symmetric: false },
        { connection_type: 'wordplay', type_key: 'wordplay', label: 'plays on', inverse_label: 'is played on by', category: 'linguistic', default_direction: 'directed', is_symmetric: false },
        { connection_type: 'parallels', type_key: 'parallels', label: 'parallels', inverse_label: 'parallels', category: 'textual', default_direction: 'bidirectional', is_symmetric: true },
        { connection_type: 'cross_reference', type_key: 'cross_reference', label: 'Cross Reference', inverse_label: 'Cross Reference', category: 'textual', default_direction: 'bidirectional', is_symmetric: true },
        { connection_type: 'thematic', type_key: 'thematic', label: 'Thematic', inverse_label: 'Thematic', category: 'thematic', default_direction: 'undirected', is_symmetric: true },
      ],
    },
    getForPassageHandler: null,
    getForWordHandler: null,
    searchTargetsHandler: null,
    getVerseWordsHandler: null,
    listHandler: null,
    abortedRequests: [],
  };
}

export const mockRpcState = globalThis.__mockRpcState;

export const BibleRPC = {
  getVerseWords: async (book, chapter, verse) => {
    if (mockRpcState.getVerseWordsHandler) {
      return mockRpcState.getVerseWordsHandler(book, chapter, verse);
    }
    if (book === 1 && chapter === 9 && verse === 6) {
      return {
        data: [
          { word_position: 1, word_id: 8210, original_word: 'שֹׁפֵךְ', transliteration: 'shofekh', strongs_nr: 'H8210', grammar_code: 'V-Qal-Ptc', primary_english: 'sheds' },
          { word_position: 2, word_id: 1818, original_word: 'דַּם', transliteration: 'dam', strongs_nr: 'H1818', grammar_code: 'N-msc', primary_english: 'blood' },
          { word_position: 3, word_id: 120, original_word: 'הָאָדָם', transliteration: 'ha·\'a·dam', strongs_nr: 'H120', grammar_code: 'Art|N-ms', primary_english: 'of man' },
          { word_position: 4, word_id: 120, original_word: 'בָּאָדָם', transliteration: 'ba·\'a·dam', strongs_nr: 'H120', grammar_code: 'Prep-b|Art|N-ms', primary_english: 'by man' },
          { word_position: 5, word_id: 1818, original_word: 'דָּמוֹ', transliteration: 'damo', strongs_nr: 'H1818', grammar_code: 'N-msc|3ms', primary_english: 'his blood' },
          { word_position: 6, word_id: 8210, original_word: 'יִשָּׁפֵךְ', transliteration: 'yishafekh', strongs_nr: 'H8210', grammar_code: 'V-Nif-Impf-3ms', primary_english: 'shall be shed' },
        ],
        error: null,
        source: 'database',
      };
    }
    return { data: [], error: null, source: 'database' };
  },
  notes: {
    connectionTypes: async () => ({
      data: mockRpcState.connectionTypesResponse,
      error: null,
      source: 'database',
    }),
    searchTargets: async (query, kinds, signal) => {
      if (signal) {
        signal.addEventListener('abort', () => {
          mockRpcState.abortedRequests.push({ query, type: 'searchTargets' });
        });
      }
      if (mockRpcState.searchTargetsHandler) {
        return mockRpcState.searchTargetsHandler(query, kinds, signal);
      }
      const q = String(query).trim().toLowerCase();
      const groups = [];

      if (q.includes('gen 9:6') || q.includes('genesis 9:6')) {
        groups.push({
          kind: 'passage',
          label: 'Passages (Verses & Ranges)',
          candidates: [{
            kind: 'verse',
            id: 212,
            label: 'Genesis 9:6',
            sublabel: 'Verse target (id: 212)',
            match_type: 'exact',
            anchor: { kind: 'verse', verse_id: 212, label: 'Genesis 9:6' },
          }],
        });
      }
      if (q === 'h120' || q.includes('120') || q.includes('אדם')) {
        groups.push({
          kind: 'lemma',
          label: 'Lemmas (Lexical roots & headwords)',
          candidates: [{
            kind: 'lemma',
            id: 120,
            label: 'אָדָם (adam)',
            sublabel: 'man, mankind [H120]',
            language: 'he',
            match_type: 'exact',
            anchor: { kind: 'lemma', lemma_id: 120, label: 'אָדָם (adam)' },
          }],
        });
        if (q.includes('אדם')) {
          groups.push({
            kind: 'word_form',
            label: 'Word Forms (Inflected surface tokens)',
            candidates: [{
              kind: 'word_form',
              id: 1050,
              label: 'הָֽאָדָ֔ם (ha·\'a·Dam)',
              sublabel: 'the man [H120]',
              language: 'he',
              match_type: 'exact',
              anchor: { kind: 'word_form', word_id: 1050, label: 'הָֽאָדָ֔ם (ha·\'a·Dam)' },
            }],
          });
        }
      }
      if (q === 'dam' || q === 'h1818' || q.includes('1818') || (q.includes('דם') && !q.includes('אדם'))) {
        groups.push({
          kind: 'lemma',
          label: 'Lemmas (Lexical roots & headwords)',
          candidates: [{
            kind: 'lemma',
            id: 1818,
            label: 'דָּם (dam)',
            sublabel: 'blood [H1818]',
            language: 'he',
            match_type: 'exact',
            anchor: { kind: 'lemma', lemma_id: 1818, label: 'דָּם (dam)' },
          }],
        });
      }
      if (q === 'logos' || q.includes('logo')) {
        groups.push({
          kind: 'lemma',
          label: 'Lemmas (Lexical roots & headwords)',
          candidates: [{
            kind: 'lemma',
            id: 3056,
            label: 'λόγος (logos)',
            sublabel: 'word, message [G3056]',
            language: 'grc',
            match_type: 'exact',
            anchor: { kind: 'lemma', lemma_id: 3056, label: 'λόγος (logos)' },
          }],
        });
      }

      return {
        data: {
          status: 'ok',
          query,
          interpretation: { type: 'text' },
          groups,
          truncated: false,
        },
        error: null,
        source: 'database',
      };
    },
    getForPassage: async (passage, opts) => {
      if (opts?.signal) {
        opts.signal.addEventListener('abort', () => {
          mockRpcState.abortedRequests.push(passage);
        });
      }
      if (mockRpcState.getForPassageHandler) {
        return mockRpcState.getForPassageHandler(passage, opts);
      }
      return {
        data: {
          primary: [],
          secondary: [],
          totals: { total: 0, human: 0, ai: 0 },
          truncated: { primary: false, secondary: false },
          token_note_counts: [],
        },
        error: null,
        source: 'database',
      };
    },
    getForWord: async (wordId, verseId, position, opts) => {
      if (opts?.signal) {
        opts.signal.addEventListener('abort', () => {
          mockRpcState.abortedRequests.push({ wordId, verseId, position });
        });
      }
      if (mockRpcState.getForWordHandler) {
        return mockRpcState.getForWordHandler(wordId, verseId, position, opts);
      }
      return {
        data: {
          status: 'ok',
          groups: { occurrence: [], form: [], lemma: [] },
          totals: { occurrence: 0, form: 0, lemma: 0, human: 0, ai: 0, total: 0 },
          lemmas: [],
        },
        error: null,
        source: 'database',
      };
    },
    save: async (payload) => {
      if (mockRpcState.overrideSave) {
        return mockRpcState.overrideSave(payload);
      }
      return {
        ok: true,
        note: {
          id: payload.id || 'mock_note_1',
          title: payload.title,
          body_md: payload.body_md,
          version: (payload.expected_version || 0) + 1,
          anchors: payload.anchors || [],
          connections: payload.connections || [],
          blocks: payload.blocks || [],
        },
      };
    },
    getNote: async (id) => {
      if (mockRpcState.overrideGetNote) {
        return mockRpcState.overrideGetNote(id);
      }
      return {
        data: {
          id,
          title: 'Mock Note',
          body_md: 'Mock body',
          version: 1,
          anchors: [],
          connections: [],
          blocks: [],
        },
        error: null,
        source: 'database',
      };
    },
    list: async (filters, cursor, opts) => {
      if (mockRpcState.listHandler) {
        return mockRpcState.listHandler(filters, cursor, opts);
      }
      return {
        data: {
          notes: [],
          page: { limit: opts?.limit ?? 25, next_cursor: null, has_more: false },
          total: 0,
        },
        error: null,
        source: 'database',
      };
    },
    remove: async (id, expectedVersion) => {
      if (mockRpcState.overrideRemove) {
        return mockRpcState.overrideRemove(id, expectedVersion);
      }
      return { ok: true, id };
    },
  },
};
