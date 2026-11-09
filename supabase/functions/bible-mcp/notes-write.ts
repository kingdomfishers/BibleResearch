// @file: supabase/functions/bible-mcp/notes-write.ts
// @feature: api
// @tables: notes | note_anchors | note_connections | note_blocks | note_authors
// @candidates: none
// @toc: imports | types | logic:auth | logic:writer | logic:tool-schemas | logic:tool-create-update | logic:tool-delete | logic:register

// === @section:imports ===
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { NOTE_SECURITY_NOTICE } from './notes-tools.ts';

// === @section:types ===
export interface AgentIdentity {
  provider: string;
  model: string;
  client?: string;
  display_name?: string;
}

export interface NotesWriterConfig {
  url: string;
  serviceRoleKey: string;
  agentKey?: string;
}

export interface NotesWriter {
  saveNote(agent: AgentIdentity, note: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteNote(agent: AgentIdentity, noteId: string): Promise<Record<string, unknown>>;
  checkAuth(headers?: Headers | null): boolean;
  hasAgentKey(): boolean;
}

export const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export const deleteAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const textContent = (text: string) => [{ type: 'text' as const, text }];

// === @section:logic:auth ===
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < aBuf.byteLength; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}

export function checkAgentAuth(headers?: Headers | null, expectedKey?: string): boolean {
  if (!expectedKey) return true;
  if (!headers) return false;
  const raw = headers.get('authorization') ?? headers.get('Authorization');
  if (!raw) return false;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return constantTimeEqual(match[1].trim(), expectedKey.trim());
}

export function deriveAgentIdentity(
  clientVersion?: { name?: string; version?: string } | null,
  userAgent?: string | null,
  explicitModel?: string | null,
): AgentIdentity {
  const clientName = (clientVersion?.name || (userAgent ? userAgent.split('/')[0] : 'mcp-client')).trim().slice(0, 80);
  const clientVer = (clientVersion?.version || '1.0').trim().slice(0, 80);
  const client = `${clientName}/${clientVer}`.slice(0, 80);
  const model = (explicitModel?.trim() || clientName || 'mcp-agent').slice(0, 80);
  let provider = 'mcp';
  const lower = `${clientName} ${model}`.toLowerCase();
  if (lower.includes('claude') || lower.includes('anthropic')) provider = 'anthropic';
  else if (lower.includes('gemini') || lower.includes('google')) provider = 'google';
  else if (lower.includes('gpt') || lower.includes('openai') || lower.includes('chatgpt')) provider = 'openai';
  else if (clientName) provider = clientName.slice(0, 80);
  const display_name = `${provider}/${model}`.slice(0, 120);
  return { provider, model, client, display_name };
}

// === @section:logic:writer ===
export function createNotesWriter(config: NotesWriterConfig, fetcher: typeof fetch = fetch): NotesWriter {
  const base = new URL(config.url);
  const callRpc = async (rpcName: string, body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const url = new URL(`/rest/v1/rpc/${rpcName}`, base);
    const res = await fetcher(url, {
      method: 'POST',
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      let errDetail = 'Database request failed';
      try {
        const errJson = await res.json();
        if (errJson?.message) errDetail = errJson.message;
      } catch { /* use fallback */ }
      return { ok: false, error: { code: 'database_error', message: errDetail } };
    }
    const data = await res.json();
    if (data && typeof data === 'object') return data as Record<string, unknown>;
    return { ok: false, error: { code: 'database_error', message: 'Unexpected response from note RPC.' } };
  };

  return {
    saveNote: (agent: AgentIdentity, note: Record<string, unknown>) => callRpc('agent_save_note_v1', { p_agent: agent, p_note: note }),
    deleteNote: (agent: AgentIdentity, noteId: string) => callRpc('agent_delete_note_v1', { p_agent: agent, p_note_id: noteId }),
    checkAuth: (headers?: Headers | null) => checkAgentAuth(headers, config.agentKey),
    hasAgentKey: () => Boolean(config.agentKey),
  };
}

// === @section:logic:tool-schemas ===
const noteKinds = [
  'observation',
  'historical_context',
  'literary_structure',
  'word_play',
  'cross_reference',
  'translation_note',
  'theological',
] as const;

export const noteAnchorInputSchema = z.strictObject({
  client_key: z.string().trim().min(1).max(64).describe('Unique client identifier for this anchor within the note.'),
  kind: z.enum(['verse', 'verse_range', 'word_occurrence', 'word_form', 'lemma', 'concept', 'place', 'event', 'note', 'external']).describe('Target anchor kind.'),
  label: z.string().trim().min(1).max(200).describe('Readable label for this anchor chip.'),
  verse_id: z.number().int().positive().optional().describe('Canonical verse ID for verse or occurrence anchors.'),
  end_verse_id: z.number().int().positive().optional().describe('Ending verse ID for verse_range anchors.'),
  word_id: z.number().int().positive().optional().describe('Word ID for word_occurrence or word_form anchors.'),
  word_position: z.number().int().min(1).optional().describe('1-based word position in verse for word_occurrence anchors.'),
  lemma_id: z.number().int().positive().optional().describe('Lemma ID for lemma anchors.'),
  concept_id: z.number().int().positive().optional().describe('Concept ID for concept anchors.'),
  place_id: z.number().int().positive().optional().describe('Place ID for place anchors.'),
  event_id: z.number().int().positive().optional().describe('Event ID for event anchors.'),
  target_note_id: z.string().regex(uuidRegex).optional().describe('Referenced note ID for note-to-note anchors.'),
  external_uri: z.string().trim().max(500).optional().describe('External HTTPS URL for reference.'),
  role: z.enum(['subject', 'object', 'mention', 'evidence']).optional().default('mention').describe('Role of this anchor (subject, object, mention, evidence).'),
});

export const noteConnectionInputSchema = z.strictObject({
  from_client_key: z.string().trim().min(1).max(64).describe('Origin anchor client_key.'),
  to_client_key: z.string().trim().min(1).max(64).describe('Destination anchor client_key.'),
  connection_type: z.string().trim().max(50).optional().describe('Type key from list_note_connection_types.'),
  custom_label: z.string().trim().max(100).optional().describe('Custom connection label if not standard.'),
  direction: z.enum(['directed', 'bidirectional', 'undirected']).optional().default('directed').describe('Direction.'),
  confidence: z.number().min(0.0).max(1.0).optional().describe('Confidence score between 0.0 and 1.0.'),
  explanation: z.string().trim().max(1000).optional().describe('Scholarly explanation of relationship.'),
});

export const noteBlockInputSchema = z.strictObject({
  block_type: z.enum(['markdown', 'link', 'image']).describe('Structured block type.'),
  content: z.record(z.string(), z.unknown()).describe('Block content (e.g. url, title, alt).'),
  text_alternative: z.string().trim().max(1000).optional().describe('Text alternative for non-text blocks.'),
  client_key: z.string().trim().max(64).optional().describe('Optional block identifier.'),
});

// === @section:logic:tool-create-update ===
function handleWriteResult(result: Record<string, unknown>, action: string) {
  if (result.ok === false) {
    const err = result.error as { code?: string; message?: string; field?: string } | undefined;
    return {
      isError: true,
      content: textContent(`Failed to ${action}: [${err?.code || 'error'}] ${err?.message || 'Operation rejected.'}`),
    };
  }
  const structuredContent = { epistemic_layer: 'user_note', notice: NOTE_SECURITY_NOTICE, ...result };
  return { content: textContent(JSON.stringify(structuredContent)), structuredContent };
}

function registerCreateNoteTool(server: McpServer, writer: NotesWriter, getHeaders?: () => Headers | undefined): void {
  server.registerTool('create_note', {
    title: 'Create AI study note with anchors and connections',
    description: 'Create a new study note. INSTRUCTIONS FOR AI: Add notes only when explicitly asked by the user or when providing clearly valuable, non-duplicate scholarly insight. Tag minimal, precise anchors (prefer word occurrences over whole verses when the claim targets a word). Set confidence (0.0 to 1.0). Put reasoning and corpus tool citations in source_context. NEVER cite user notes as source evidence for the biblical text.',
    inputSchema: z.strictObject({
      title: z.string().trim().max(200).optional().describe('Brief note title (optional).'),
      body_md: z.string().trim().min(1).max(20000).describe('Markdown body of the note (max 20,000 characters).'),
      note_kind: z.enum(noteKinds).describe('Scholarly category of note.'),
      language: z.string().trim().max(16).optional().default('en').describe('Language code (e.g. en, he, grc).'),
      confidence: z.number().min(0.0).max(1.0).optional().describe('Scholarly confidence (0.0 to 1.0).'),
      anchors: z.array(noteAnchorInputSchema).min(1).max(20).describe('Target anchors. Each needs a unique client_key.'),
      connections: z.array(noteConnectionInputSchema).max(20).optional().default([]).describe('Semantic connections between anchors.'),
      blocks: z.array(noteBlockInputSchema).max(10).optional().default([]).describe('Structured content blocks (link or image).'),
      source_context: z.record(z.string(), z.unknown()).optional().describe('Corpus tool calls, evidence refs, and reasoning (max 8 KB).'),
      model: z.string().trim().max(80).optional().describe('Self-reported model identifier (e.g. claude-3-5-sonnet, gpt-4o).'),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    annotations: writeAnnotations,
  }, async args => {
    const headers = getHeaders?.();
    if (!writer.checkAuth(headers)) return { isError: true, content: textContent('Writing notes requires the agent key') };
    const agent = deriveAgentIdentity(server.server.getClientVersion?.(), headers?.get('user-agent'), args.model);
    const { model: _m, ...notePayload } = args;
    try {
      return handleWriteResult(await writer.saveNote(agent, notePayload), 'create note');
    } catch { return { isError: true, content: textContent('The note writing service is temporarily unavailable.') }; }
  });
}

function registerUpdateNoteTool(server: McpServer, writer: NotesWriter, getHeaders?: () => Headers | undefined): void {
  server.registerTool('update_my_note', {
    title: 'Update existing AI-authored note',
    description: 'Update an existing AI-authored note. Requires expected_version for optimistic concurrency. Only updates notes authored by this agent. INSTRUCTIONS FOR AI: Prefer updating existing notes over creating near-duplicates. Tag minimal precise anchors, set confidence, and document changes in source_context.',
    inputSchema: z.strictObject({
      note_id: z.string().regex(uuidRegex, 'Must be a valid UUID').describe('UUID of the note to update (must be authored by this agent).'),
      expected_version: z.number().int().min(1).describe('Optimistic locking: expected current version.'),
      title: z.string().trim().max(200).optional().describe('Updated note title.'),
      body_md: z.string().trim().min(1).max(20000).describe('Updated markdown body.'),
      note_kind: z.enum(noteKinds).describe('Updated category.'),
      language: z.string().trim().max(16).optional().default('en'),
      confidence: z.number().min(0.0).max(1.0).optional(),
      anchors: z.array(noteAnchorInputSchema).min(1).max(20),
      connections: z.array(noteConnectionInputSchema).max(20).optional().default([]),
      blocks: z.array(noteBlockInputSchema).max(10).optional().default([]),
      source_context: z.record(z.string(), z.unknown()).optional(),
      model: z.string().trim().max(80).optional(),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    annotations: writeAnnotations,
  }, async args => {
    const headers = getHeaders?.();
    if (!writer.checkAuth(headers)) return { isError: true, content: textContent('Writing notes requires the agent key') };
    const agent = deriveAgentIdentity(server.server.getClientVersion?.(), headers?.get('user-agent'), args.model);
    const { model: _m, note_id, ...noteFields } = args;
    try {
      return handleWriteResult(await writer.saveNote(agent, { id: note_id, ...noteFields }), 'update note');
    } catch { return { isError: true, content: textContent('The note writing service is temporarily unavailable.') }; }
  });
}

// === @section:logic:tool-delete ===
function registerDeleteNoteTool(server: McpServer, writer: NotesWriter, getHeaders?: () => Headers | undefined): void {
  server.registerTool('delete_my_note', {
    title: 'Soft-delete AI-authored note',
    description: 'Soft-delete an existing AI-authored note. Only deletes notes authored by this agent; human notes and notes from other agents cannot be deleted.',
    inputSchema: z.strictObject({
      note_id: z.string().regex(uuidRegex, 'Must be a valid UUID').describe('UUID of the AI-authored note to delete.'),
      model: z.string().trim().max(80).optional().describe('Self-reported model identifier (optional).'),
    }),
    outputSchema: z.record(z.string(), z.unknown()),
    annotations: deleteAnnotations,
  }, async args => {
    const headers = getHeaders?.();
    if (!writer.checkAuth(headers)) return { isError: true, content: textContent('Writing notes requires the agent key') };
    const agent = deriveAgentIdentity(server.server.getClientVersion?.(), headers?.get('user-agent'), args.model);
    try {
      const res = await writer.deleteNote(agent, args.note_id);
      return handleWriteResult(res, 'delete note');
    } catch { return { isError: true, content: textContent('The note deletion service is temporarily unavailable.') }; }
  });
}

// === @section:logic:register ===
export function registerNoteWriteTools(
  server: McpServer,
  writer: NotesWriter,
  getHeaders?: () => Headers | undefined,
): void {
  registerCreateNoteTool(server, writer, getHeaders);
  registerUpdateNoteTool(server, writer, getHeaders);
  registerDeleteNoteTool(server, writer, getHeaders);
}
