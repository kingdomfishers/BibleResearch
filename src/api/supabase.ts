// @file: src/api/supabase.ts
// @feature: api
// @tables: words | verses | word_translation_choices
// @candidates: none
// @toc: imports | logic:client | logic:reader-session

// === @section:imports ===
import { createClient } from '@supabase/supabase-js';

// === @section:logic:client ===
const env = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
function createOptionalClient() {
  if (!url || !key || url.includes('your-project') || key.includes('your-')) return null;
  try {
    return createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  } catch { return null; }
}
export const supabase = createOptionalClient();

// === @section:logic:reader-session ===
export async function restoreReaderSession() {
  if (!supabase) throw new Error('Database connection is not configured.');
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error('Your saved translations could not be restored. Please retry.');
  return data.session;
}
let readerSignIn: Promise<void> | null = null;
export function ensureReaderSession(): Promise<void> {
  if (!readerSignIn) {
    readerSignIn = (async () => {
      const session = await restoreReaderSession();
      if (session) return;
      const { error } = await supabase!.auth.signInAnonymously();
      if (error) throw new Error(error.code === 'anonymous_provider_disabled'
        ? 'Private saving is not enabled yet.' : 'A private reader session could not be opened. Please retry.');
    })().finally(() => { readerSignIn = null; });
  }
  return readerSignIn;
}
