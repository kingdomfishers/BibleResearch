-- Private expiring session chains for MCP follow_connectionchain (24h TTL, server-enforced secret hash).
CREATE TABLE IF NOT EXISTS public.mcp_connection_chains (
  chain_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  session_hash TEXT,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_connection_chains_expires_at
  ON public.mcp_connection_chains (expires_at);

ALTER TABLE public.mcp_connection_chains ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mcp_connection_chains FROM PUBLIC, anon, authenticated;
