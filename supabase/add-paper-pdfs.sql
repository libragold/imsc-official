alter table papers add column if not exists pdf_bucket text not null default 'paper-pdfs';
alter table papers add column if not exists pdf_path text;
alter table papers add column if not exists pdf_original_name text;
alter table papers add column if not exists pdf_size_bytes bigint;
alter table papers add column if not exists pdf_uploaded_at timestamptz;
alter table papers drop constraint if exists papers_pdf_size_bytes_check;
alter table papers add constraint papers_pdf_size_bytes_check check (pdf_size_bytes is null or pdf_size_bytes >= 0);
create unique index if not exists papers_pdf_object_unique_idx on papers (pdf_bucket, pdf_path) where pdf_path is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('paper-pdfs', 'paper-pdfs', false, 52428800, array['application/pdf'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "authenticated read paper pdf objects" on storage.objects;
create policy "authenticated read paper pdf objects"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'paper-pdfs');

drop view if exists paper_status;
create view paper_status
with (security_invoker = true)
as
select
  p.id as paper_id,
  p.student_id,
  s.team_id,
  t.name as team_name,
  t.code as team_code,
  s.team_index,
  s.name as student_name,
  p.problem_id,
  p.initial_score,
  p.initial_score_coordinator_id,
  isc.name as initial_score_coordinator_name,
  my_ish.score as my_initial_score,
  my_ish.id as my_initial_score_id,
  p.agreed_score,
  p.agreed_score_coordinator_id,
  asc_coordinator.name as agreed_score_coordinator_name,
  asc_coordinator.avatar_seed as agreed_score_coordinator_avatar_seed,
  p.agreed_score_team_leader_signature,
  my_pc.id as active_claim_id,
  my_pc.coordinator_id as active_claim_coordinator_id,
  me.name as active_claim_coordinator_name,
  my_pc.created_at as active_claim_created_at,
  claim_summary.active_claim_count,
  claim_summary.active_claim_coordinator_names,
  claim_summary.active_claims,
  initial_summary.current_initial_score_count,
  initial_summary.current_initial_scores,
  initial_summary.initial_score_conflict,
  p.pdf_bucket,
  p.pdf_path,
  p.pdf_original_name,
  p.pdf_size_bytes,
  p.pdf_uploaded_at,
  p.updated_at
from papers p
join students s on s.id = p.student_id
join teams t on t.id = s.team_id
left join coordinators me on me.auth_user_id = auth.uid() and me.active = true
left join coordinators isc on isc.id = p.initial_score_coordinator_id
left join coordinators asc_coordinator on asc_coordinator.id = p.agreed_score_coordinator_id
left join paper_claims my_pc on my_pc.paper_id = p.id and my_pc.coordinator_id = me.id and my_pc.released_at is null
left join initial_score_history my_ish on my_ish.paper_id = p.id and my_ish.coordinator_id = me.id and my_ish.superseded_at is null
left join lateral (
  select
    count(*)::integer as active_claim_count,
    string_agg(c.name, ', ' order by c.name) as active_claim_coordinator_names,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'claim_id', pc.id,
          'coordinator_id', c.id,
          'name', c.name,
          'avatar_seed', c.avatar_seed
        )
        order by c.name
      ),
      '[]'::jsonb
    ) as active_claims
  from paper_claims pc
  join coordinators c on c.id = pc.coordinator_id
  where pc.paper_id = p.id
    and pc.released_at is null
) claim_summary on true
left join lateral (
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'coordinator_id', c.id,
          'name', c.name,
          'avatar_seed', c.avatar_seed,
          'score', ish.score
        )
        order by c.name
      ),
      '[]'::jsonb
    ) as current_initial_scores,
    count(*)::integer as current_initial_score_count,
    count(distinct ish.score) > 1 as initial_score_conflict
  from initial_score_history ish
  join coordinators c on c.id = ish.coordinator_id
  where ish.paper_id = p.id
    and ish.superseded_at is null
) initial_summary on true;

grant select on paper_status to authenticated, service_role;

notify pgrst, 'reload schema';
