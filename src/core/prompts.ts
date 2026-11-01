// @file: src/core/prompts.ts
// @feature: api
// @tables: words | verses
// @candidates: none
// @toc: imports | logic:compatibility

// === @section:imports ===
import { BibleRPC } from '../api/rpc';

// === @section:logic:compatibility ===
export const getWordsInVerse = async (book: number, chapter: number, verse: number) =>
  (await BibleRPC.getVerseWords(book, chapter, verse)).data;
export const findVersesByWord = async (id: number) => (await BibleRPC.getWordOccurrences(id)).data;
export const getRelatedWords = async (id: number) => (await BibleRPC.getWordCoOccurrences(id)).data;
export const findWordRelationships = async (ids: number[]) => (await BibleRPC.getWordRelationships(ids)).data;
export const getWordDetails = async (id: number) => (await BibleRPC.getWordDetails(id)).data;
