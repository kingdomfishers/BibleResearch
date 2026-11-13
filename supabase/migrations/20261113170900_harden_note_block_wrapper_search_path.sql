-- Pin the compatibility overload; the implementation overload is already pinned.
-- Preserve the body, SECURITY INVOKER behavior, signature, volatility and grants.
ALTER FUNCTION public.note_validate_block_v1(text, jsonb) SET search_path = '';
