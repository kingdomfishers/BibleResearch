-- Preserve the relationship contract with a bounded function-level public API budget.
alter function public.research_relationships_v1(jsonb) set statement_timeout = '8s';
notify pgrst, 'reload schema';
