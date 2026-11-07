create table if not exists public.lexical_formations (
 id bigint generated always as identity primary key,
 lemma_id bigint not null references public.lemmas(id) on delete cascade,
 analysis_key text not null,
 formation_type text not null check (formation_type in ('compound','theophoric_name','derivation','other')),
 whole_word_gloss text,
 evidence_status text not null check (evidence_status in ('documented','proposed','disputed','rejected')),
 evidence_note text not null,
 source_title text,
 source_url text,
 source_record_id text,
 origin_mode text not null default 'sourced' check (origin_mode in ('sourced','editorial_candidate','algorithmic_candidate')),
 review_status text not null default 'unreviewed' check (review_status in ('unreviewed','reviewed')),
 created_at timestamptz not null default now(),
 unique (lemma_id,analysis_key),
 check (length(btrim(analysis_key))>0),
 check (origin_mode <> 'algorithmic_candidate' or evidence_status <> 'documented')
);
comment on table public.lexical_formations is 'Claim-level source-backed analyses of how lemmas are formed. Whole-word gloss belongs to a lexical analysis, never to an abstract consonantal root. Documented is source-attested, not expert-review status.';
create index if not exists idx_lexical_formations_lemma on public.lexical_formations(lemma_id);
create table if not exists public.lemma_components (
 id bigint generated always as identity primary key,
 formation_id bigint not null references public.lexical_formations(id) on delete cascade,
 component_order smallint not null check (component_order > 0),
 component_lemma_id bigint references public.lemmas(id),
 component_lexeme_id bigint references public.lexemes(id),
 surface_text text not null check (length(btrim(surface_text))>0),
 component_role text not null check (component_role in ('verbal_element','nominal_element','divine_name_element','prefix','suffix','other')),
 semantic_contribution text,
 component_note text,
 unique (formation_id,component_order),
 check (component_lemma_id is not null or component_lexeme_id is not null)
);
comment on table public.lemma_components is 'Ordered lexical formation components, not surface-token morphemes. Canonical lemma/lexeme IDs identify disambiguated meanings.';
create index if not exists idx_lemma_components_component_lemma on public.lemma_components(component_lemma_id);
create index if not exists idx_lemma_components_component_lexeme on public.lemma_components(component_lexeme_id);
create table if not exists public.lexical_connections (
 id bigint generated always as identity primary key,
 subject_lemma_id bigint not null references public.lemmas(id) on delete cascade,
 target_lemma_id bigint not null references public.lemmas(id) on delete cascade,
 relation_type text not null check (relation_type in ('literary_wordplay','orthographic_overlap','phonetic_resemblance','proposed_derivation')),
 evidence_status text not null check (evidence_status in ('documented_textual','observed_form','unverified_hypothesis','disputed','rejected')),
 evidence_note text not null,
 passage_reference text,
 source_title text,
 source_url text,
 derivation_method text not null,
 created_at timestamptz not null default now(),
 unique (subject_lemma_id,target_lemma_id,relation_type),
 check (subject_lemma_id <> target_lemma_id),
 check (relation_type <> 'orthographic_overlap' or evidence_status <> 'documented_textual')
);
comment on table public.lexical_connections is 'Literary/formal connections distinct from documented derivation and root family. Similar spelling alone cannot assert etymology or synonymy.';
create index if not exists idx_lexical_connections_subject on public.lexical_connections(subject_lemma_id);
create index if not exists idx_lexical_connections_target on public.lexical_connections(target_lemma_id);
alter table public.lexical_formations enable row level security;
alter table public.lemma_components enable row level security;
alter table public.lexical_connections enable row level security;
revoke all on public.lexical_formations,public.lemma_components,public.lexical_connections from public,anon,authenticated;
grant select on public.lexical_formations,public.lemma_components,public.lexical_connections to anon,authenticated;
create policy lexical_formations_public_read on public.lexical_formations for select to anon,authenticated using (true);
create policy lemma_components_public_read on public.lemma_components for select to anon,authenticated using (true);
create policy lexical_connections_public_read on public.lexical_connections for select to anon,authenticated using (true);
insert into public.lexical_formations
 (lemma_id,analysis_key,formation_type,whole_word_gloss,evidence_status,evidence_note,source_title,source_url,source_record_id,origin_mode)
select id,'strongs-h7501-name-formation','theophoric_name','God has healed / God heals','documented',
 'Strong''s H7501 explicitly identifies the name as formed from H7495 (to heal) and H410 (El, God); the name is attested in 1 Chronicles 26:7. The precise English rendering is a gloss, not a separate component.',
 'Strong''s Exhaustive Concordance: H7501','https://biblehub.com/strongs/hebrew/7501.htm','H7501','sourced'
from public.lemmas where lemma_key='lemma:H7501'
on conflict (lemma_id,analysis_key) do nothing;
insert into public.lemma_components
 (formation_id,component_order,component_lemma_id,component_lexeme_id,surface_text,component_role,semantic_contribution,component_note)
select f.id,1,l.id,l.primary_lexeme_id,'רפא','verbal_element','heal','H7495 is the verbal element in the traditional derivation; the surface of the complete name is vocalized differently.'
from public.lexical_formations f join public.lemmas host on host.id=f.lemma_id and host.lemma_key='lemma:H7501'
join public.lemmas l on l.lemma_key='lemma:H7495'
where f.analysis_key='strongs-h7501-name-formation'
on conflict (formation_id,component_order) do nothing;
insert into public.lemma_components
 (formation_id,component_order,component_lemma_id,component_lexeme_id,surface_text,component_role,semantic_contribution,component_note)
select f.id,2,l.id,l.primary_lexeme_id,'אל','divine_name_element','God','H410 has multiple differentiated lexical entries; the divine-name element here points specifically to lemma:H0410G.'
from public.lexical_formations f join public.lemmas host on host.id=f.lemma_id and host.lemma_key='lemma:H7501'
join public.lemmas l on l.lemma_key='lemma:H0410G'
where f.analysis_key='strongs-h7501-name-formation'
on conflict (formation_id,component_order) do nothing;
insert into public.lexical_connections
 (subject_lemma_id,target_lemma_id,relation_type,evidence_status,evidence_note,passage_reference,source_title,source_url,derivation_method)
select a.id,b.id,'literary_wordplay','documented_textual',
 'Genesis 2:5–7 juxtaposes האדם / אדם (human) and אדמה (ground). This is a literary/lexical association in the text; it does not establish a directional historical derivation.',
 'Genesis 2:5–7','Hebrew text of Genesis 2:5–7',null,'source_text_juxtaposition'
from public.lemmas a,public.lemmas b where a.lemma_key='lemma:H0120G' and b.lemma_key='lemma:H0127G'
on conflict (subject_lemma_id,target_lemma_id,relation_type) do nothing;
insert into public.lexical_connections
 (subject_lemma_id,target_lemma_id,relation_type,evidence_status,evidence_note,passage_reference,source_title,source_url,derivation_method)
select a.id,b.id,'orthographic_overlap','observed_form',
 'Consonantal spelling of אדם contains the sequence דם, identical to the consonants of דם (blood). This observation does NOT establish a historical root, derivation or semantic identity.',
 null,'BibleResearch orthographic observation',null,'exact_consonantal_substring_v1'
from public.lemmas a,public.lemmas b where a.lemma_key='lemma:H0120G' and b.lemma_key='lemma:H1818'
on conflict (subject_lemma_id,target_lemma_id,relation_type) do nothing;
