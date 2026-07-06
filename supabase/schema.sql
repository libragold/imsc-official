create extension if not exists pgcrypto;

create table if not exists coordinators (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique not null,
  name text unique not null,
  avatar_seed text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table coordinators add column if not exists avatar_seed text;

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  code text unique,
  created_at timestamptz not null default now()
);

alter table teams add column if not exists code text;
create unique index if not exists teams_code_unique_idx on teams (code) where code is not null;

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  team_index smallint not null check (team_index between 1 and 8),
  name text not null,
  created_at timestamptz not null default now(),
  unique (team_id, team_index)
);

alter table students drop constraint if exists students_team_index_check;
alter table students add constraint students_team_index_check check (team_index between 1 and 8);

create table if not exists papers (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  problem_id smallint not null check (problem_id between 1 and 6),
  initial_score smallint check (initial_score between 0 and 7),
  initial_score_coordinator_id uuid references coordinators(id),
  agreed_score smallint check (agreed_score between 0 and 7),
  agreed_score_coordinator_id uuid references coordinators(id),
  agreed_score_team_leader_signature text,
  pdf_bucket text not null default 'paper-pdfs',
  pdf_path text,
  pdf_original_name text,
  pdf_size_bytes bigint check (pdf_size_bytes is null or pdf_size_bytes >= 0),
  pdf_uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, problem_id)
);

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

create table if not exists initial_score_history (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references papers(id) on delete cascade,
  score smallint not null check (score between 0 and 7),
  coordinator_id uuid not null references coordinators(id),
  created_at timestamptz not null default now(),
  superseded_at timestamptz
);

alter table initial_score_history add column if not exists superseded_at timestamptz;

create table if not exists agreed_score_history (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references papers(id) on delete cascade,
  score smallint not null check (score between 0 and 7),
  coordinator_id uuid not null references coordinators(id),
  team_leader_signature text not null,
  created_at timestamptz not null default now()
);

create table if not exists paper_claims (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references papers(id) on delete cascade,
  coordinator_id uuid not null references coordinators(id),
  created_at timestamptz not null default now(),
  released_at timestamptz
);

drop index if exists one_active_claim_per_paper;

create unique index if not exists one_active_claim_per_coordinator_paper
  on paper_claims (paper_id, coordinator_id)
  where released_at is null;

create index if not exists paper_claims_coordinator_active_idx
  on paper_claims (coordinator_id)
  where released_at is null;

update initial_score_history h
set superseded_at = h.created_at
where h.superseded_at is null
  and exists (
    select 1
    from initial_score_history newer
    where newer.paper_id = h.paper_id
      and newer.coordinator_id = h.coordinator_id
      and newer.superseded_at is null
      and (
        newer.created_at > h.created_at
        or (newer.created_at = h.created_at and newer.id::text > h.id::text)
      )
  );

update papers p
set initial_score = latest.score,
    initial_score_coordinator_id = latest.coordinator_id
from (
  select distinct on (paper_id)
    paper_id,
    score,
    coordinator_id
  from initial_score_history
  where superseded_at is null
  order by paper_id, created_at desc
) latest
where p.id = latest.paper_id;

update papers p
set initial_score = null,
    initial_score_coordinator_id = null
where not exists (
  select 1
  from initial_score_history h
  where h.paper_id = p.id
    and h.superseded_at is null
);

create unique index if not exists one_initial_score_per_coordinator_paper
  on initial_score_history (paper_id, coordinator_id)
  where superseded_at is null;

create index if not exists students_team_idx on students (team_id, team_index);
create index if not exists papers_problem_idx on papers (problem_id);
create index if not exists initial_score_history_paper_idx on initial_score_history (paper_id, created_at desc);
create index if not exists agreed_score_history_paper_idx on agreed_score_history (paper_id, created_at desc);

alter table coordinators enable row level security;
alter table teams enable row level security;
alter table students enable row level security;
alter table papers enable row level security;
alter table initial_score_history enable row level security;
alter table agreed_score_history enable row level security;
alter table paper_claims enable row level security;

drop policy if exists "authenticated read coordinators" on coordinators;
create policy "authenticated read coordinators"
  on coordinators for select
  to authenticated
  using (true);

drop policy if exists "authenticated read teams" on teams;
create policy "authenticated read teams"
  on teams for select
  to authenticated
  using (true);

drop policy if exists "authenticated read students" on students;
create policy "authenticated read students"
  on students for select
  to authenticated
  using (true);

drop policy if exists "authenticated read papers" on papers;
create policy "authenticated read papers"
  on papers for select
  to authenticated
  using (true);

drop policy if exists "authenticated read initial history" on initial_score_history;
create policy "authenticated read initial history"
  on initial_score_history for select
  to authenticated
  using (true);

drop policy if exists "authenticated read agreed history" on agreed_score_history;
create policy "authenticated read agreed history"
  on agreed_score_history for select
  to authenticated
  using (true);

drop policy if exists "authenticated read claims" on paper_claims;
create policy "authenticated read claims"
  on paper_claims for select
  to authenticated
  using (true);

create or replace function touch_papers_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists papers_touch_updated_at on papers;
create trigger papers_touch_updated_at
  before update on papers
  for each row
  execute function touch_papers_updated_at();

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

create or replace view initial_score_history_view
with (security_invoker = true)
as
select
  h.id,
  h.paper_id,
  h.score,
  h.coordinator_id,
  c.name as coordinator_name,
  h.created_at
from initial_score_history h
join coordinators c on c.id = h.coordinator_id;

create or replace view agreed_score_history_view
with (security_invoker = true)
as
select
  h.id,
  h.paper_id,
  h.score,
  h.coordinator_id,
  c.name as coordinator_name,
  h.team_leader_signature,
  h.created_at
from agreed_score_history h
join coordinators c on c.id = h.coordinator_id;

drop view if exists public_coordination_status;
create view public_coordination_status
as
select
  t.name as team_name,
  s.team_index,
  s.name as student_name,
  p.problem_id,
  (p.agreed_score is not null) as coordination_finished,
  initial_summary.current_initial_score_count >= 2 as has_two_initial_scores,
  case
    when initial_summary.current_initial_score_count >= 2 then initial_summary.current_initial_score_people
    else '[]'::jsonb
  end as current_initial_score_people
from papers p
join students s on s.id = p.student_id
join teams t on t.id = s.team_id
left join lateral (
  select
    count(*)::integer as current_initial_score_count,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name', c.name,
          'avatar_seed', c.avatar_seed
        )
        order by c.name
      ),
      '[]'::jsonb
    ) as current_initial_score_people
  from initial_score_history ish
  join coordinators c on c.id = ish.coordinator_id
  where ish.paper_id = p.id
    and ish.superseded_at is null
) initial_summary on true;

grant select on public_coordination_status to anon, authenticated;

drop view if exists coordination_stats_coordinators;
create view coordination_stats_coordinators
with (security_invoker = true)
as
select
  c.id as coordinator_id,
  c.name,
  c.avatar_seed,
  count(p.id)::integer as graded_count
from coordinators c
left join initial_score_history ish
  on ish.coordinator_id = c.id
  and ish.superseded_at is null
left join papers p
  on p.id = ish.paper_id
  and p.pdf_path is not null
where c.active = true
group by c.id, c.name, c.avatar_seed;

drop view if exists coordination_stats_countries;
create view coordination_stats_countries
with (security_invoker = true)
as
with paper_progress as (
  select
    p.id,
    t.name as team_name,
    p.agreed_score,
    count(ish.id)::integer as current_initial_score_count
  from papers p
  join students s on s.id = p.student_id
  join teams t on t.id = s.team_id
  left join initial_score_history ish
    on ish.paper_id = p.id
    and ish.superseded_at is null
  group by p.id, t.name, p.agreed_score
)
select
  team_name,
  count(*)::integer as total_count,
  count(*) filter (where agreed_score is not null)::integer as coordinated_count,
  count(*) filter (where agreed_score is null and current_initial_score_count >= 2)::integer as ready_count
from paper_progress
group by team_name;

drop view if exists coordination_stats_problems;
create view coordination_stats_problems
with (security_invoker = true)
as
with paper_progress as (
  select
    p.id,
    p.problem_id,
    p.agreed_score,
    count(ish.id)::integer as current_initial_score_count
  from papers p
  left join initial_score_history ish
    on ish.paper_id = p.id
    and ish.superseded_at is null
  group by p.id, p.problem_id, p.agreed_score
)
select
  problem_id,
  count(*)::integer as total_count,
  count(*) filter (where agreed_score is not null)::integer as coordinated_count,
  count(*) filter (where agreed_score is null and current_initial_score_count >= 2)::integer as ready_count
from paper_progress
group by problem_id;

create or replace function current_coordinator_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id
  from coordinators
  where auth_user_id = auth.uid()
    and active = true
  limit 1
$$;

create or replace function require_current_coordinator_id()
returns uuid
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_coordinator_id uuid;
begin
  select current_coordinator_id() into v_coordinator_id;
  if v_coordinator_id is null then
    raise exception 'No active coordinator profile for current user';
  end if;
  return v_coordinator_id;
end;
$$;

create or replace function claim_paper(p_paper_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coordinator_id uuid;
  v_claim_id uuid;
begin
  v_coordinator_id := require_current_coordinator_id();

  if not exists (select 1 from papers where id = p_paper_id) then
    raise exception 'Paper does not exist';
  end if;

  select id
  into v_claim_id
  from paper_claims
  where paper_id = p_paper_id
    and coordinator_id = v_coordinator_id
    and released_at is null
  limit 1;

  if found then
    return v_claim_id;
  end if;

  insert into paper_claims (paper_id, coordinator_id)
  values (p_paper_id, v_coordinator_id)
  returning id into v_claim_id;

  return v_claim_id;
exception
  when unique_violation then
    select id
    into v_claim_id
    from paper_claims
    where paper_id = p_paper_id
      and coordinator_id = v_coordinator_id
      and released_at is null
    limit 1;
    return v_claim_id;
end;
$$;

create or replace function release_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coordinator_id uuid;
  v_updated_count integer;
begin
  v_coordinator_id := require_current_coordinator_id();

  update paper_claims
  set released_at = now()
  where id = p_claim_id
    and coordinator_id = v_coordinator_id
    and released_at is null;

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 0 then
    raise exception 'Active claim not found for current coordinator';
  end if;
end;
$$;

create or replace function assert_active_claim(p_paper_id uuid, p_coordinator_id uuid)
returns void
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (
    select 1
    from paper_claims
    where paper_id = p_paper_id
      and coordinator_id = p_coordinator_id
      and released_at is null
  ) then
    raise exception 'Current coordinator must actively claim this paper first';
  end if;
end;
$$;

drop function if exists submit_initial_score(uuid, smallint);
create or replace function submit_initial_score(p_paper_id uuid, p_score integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coordinator_id uuid;
begin
  if p_score is null or p_score < 0 or p_score > 7 then
    raise exception 'Initial score must be between 0 and 7';
  end if;

  v_coordinator_id := require_current_coordinator_id();
  perform assert_active_claim(p_paper_id, v_coordinator_id);

  update initial_score_history
  set superseded_at = now()
  where paper_id = p_paper_id
    and coordinator_id = v_coordinator_id
    and superseded_at is null;

  insert into initial_score_history (paper_id, score, coordinator_id)
  values (p_paper_id, p_score::smallint, v_coordinator_id);

  update papers
  set initial_score = p_score::smallint,
      initial_score_coordinator_id = v_coordinator_id
  where id = p_paper_id;
end;
$$;

drop function if exists submit_agreed_score(uuid, smallint, text);
create or replace function submit_agreed_score(
  p_paper_id uuid,
  p_score integer,
  p_team_leader_signature text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coordinator_id uuid;
  v_signature text;
begin
  if p_score is null or p_score < 0 or p_score > 7 then
    raise exception 'Agreed score must be between 0 and 7';
  end if;

  v_signature := nullif(trim(coalesce(p_team_leader_signature, '')), '');
  if lower(coalesce(v_signature, '')) = 'not required' then
    v_signature := null;
  end if;

  v_coordinator_id := require_current_coordinator_id();
  perform assert_active_claim(p_paper_id, v_coordinator_id);

  insert into agreed_score_history (paper_id, score, coordinator_id, team_leader_signature)
  values (p_paper_id, p_score::smallint, v_coordinator_id, coalesce(v_signature, ''));

  update papers
  set agreed_score = p_score::smallint,
      agreed_score_coordinator_id = v_coordinator_id,
      agreed_score_team_leader_signature = v_signature
  where id = p_paper_id;
end;
$$;

create or replace function clear_initial_score(p_paper_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coordinator_id uuid;
begin
  v_coordinator_id := require_current_coordinator_id();
  perform assert_active_claim(p_paper_id, v_coordinator_id);

  if exists (
    select 1
    from papers
    where id = p_paper_id
      and agreed_score is not null
  ) then
    raise exception 'Clear the agreed score before clearing the initial score';
  end if;

  update initial_score_history
  set superseded_at = now()
  where paper_id = p_paper_id
    and coordinator_id = v_coordinator_id
    and superseded_at is null;

  update papers p
  set initial_score = latest.score,
      initial_score_coordinator_id = latest.coordinator_id
  from (
    select score, coordinator_id
    from initial_score_history
    where paper_id = p_paper_id
      and superseded_at is null
    order by created_at desc
    limit 1
  ) latest
  where p.id = p_paper_id;

  update papers
  set initial_score = null,
      initial_score_coordinator_id = null
  where id = p_paper_id
    and not exists (
      select 1
      from initial_score_history
      where paper_id = p_paper_id
        and superseded_at is null
    );
end;
$$;

create or replace function clear_agreed_score(p_paper_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coordinator_id uuid;
begin
  v_coordinator_id := require_current_coordinator_id();
  perform assert_active_claim(p_paper_id, v_coordinator_id);

  if not exists (
    select 1
    from papers
    where id = p_paper_id
      and agreed_score is not null
      and agreed_score_coordinator_id = v_coordinator_id
  ) then
    raise exception 'Only the coordinator who entered this agreed score can unset it';
  end if;

  update papers
  set agreed_score = null,
      agreed_score_coordinator_id = null,
      agreed_score_team_leader_signature = null
  where id = p_paper_id;
end;
$$;

create or replace function update_avatar_seed(p_avatar_seed text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coordinator_id uuid;
  v_seed text;
begin
  v_coordinator_id := require_current_coordinator_id();
  v_seed := lower(trim(p_avatar_seed));

  if v_seed is null or v_seed !~ '^[a-z0-9]{1,32}$' then
    raise exception 'Avatar seed must use 1 to 32 lowercase letters or digits';
  end if;

  update coordinators
  set avatar_seed = v_seed
  where id = v_coordinator_id;
end;
$$;

grant usage on schema public to authenticated;
grant select on
  coordinators,
  teams,
  students,
  papers,
  paper_claims,
  initial_score_history,
  agreed_score_history,
  paper_status,
  initial_score_history_view,
  agreed_score_history_view,
  coordination_stats_coordinators,
  coordination_stats_countries,
  coordination_stats_problems
to authenticated;

grant execute on function current_coordinator_id() to authenticated;
grant execute on function claim_paper(uuid) to authenticated;
grant execute on function release_claim(uuid) to authenticated;
grant execute on function submit_initial_score(uuid, integer) to authenticated;
grant execute on function submit_agreed_score(uuid, integer, text) to authenticated;
grant execute on function clear_initial_score(uuid) to authenticated;
grant execute on function clear_agreed_score(uuid) to authenticated;
grant execute on function update_avatar_seed(text) to authenticated;

grant usage on schema public to service_role;
grant all privileges on
  coordinators,
  teams,
  students,
  papers,
  paper_claims,
  initial_score_history,
  agreed_score_history
to service_role;

grant select on
  paper_status,
  initial_score_history_view,
  agreed_score_history_view,
  coordination_stats_coordinators,
  coordination_stats_countries,
  coordination_stats_problems
to service_role;

grant execute on function current_coordinator_id() to service_role;
grant execute on function claim_paper(uuid) to service_role;
grant execute on function release_claim(uuid) to service_role;
grant execute on function submit_initial_score(uuid, integer) to service_role;
grant execute on function submit_agreed_score(uuid, integer, text) to service_role;
grant execute on function clear_initial_score(uuid) to service_role;
grant execute on function clear_agreed_score(uuid) to service_role;
grant execute on function update_avatar_seed(text) to service_role;
