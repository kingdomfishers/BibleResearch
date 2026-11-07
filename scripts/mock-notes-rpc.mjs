if (!globalThis.__mockRpcState) {
  globalThis.__mockRpcState = {
    connectionTypesResponse: {
      note_kinds: [
        { note_kind: 'study', label: 'Study' },
        { note_kind: 'translation_note', label: 'Translation' },
        { note_kind: 'exegetical', label: 'Exegetical' },
      ],
      connection_types: [
        { type_key: 'cross_reference', label: 'Cross Reference' },
        { type_key: 'thematic', label: 'Thematic' },
      ],
    },
    getForPassageHandler: null,
    abortedRequests: [],
  };
}

export const mockRpcState = globalThis.__mockRpcState;

export const BibleRPC = {
  notes: {
    connectionTypes: async () => ({
      data: mockRpcState.connectionTypesResponse,
      error: null,
      source: 'database',
    }),
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
  },
};
