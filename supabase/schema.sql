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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, problem_id)
);

create table if not exists initial_score_history (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references papers(id) on delete cascade,
  score smallint not null check (score between 0 and 7),
  coordinator_id uuid not null references coordinators(id),
  created_at timestamptz not null default now()
);

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

create unique index if not exists one_active_claim_per_paper
  on paper_claims (paper_id)
  where released_at is null;

create index if not exists paper_claims_coordinator_active_idx
  on paper_claims (coordinator_id)
  where released_at is null;

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
  p.agreed_score,
  p.agreed_score_coordinator_id,
  asc_coordinator.name as agreed_score_coordinator_name,
  p.agreed_score_team_leader_signature,
  pc.id as active_claim_id,
  pc.coordinator_id as active_claim_coordinator_id,
  cc.name as active_claim_coordinator_name,
  pc.created_at as active_claim_created_at,
  p.updated_at
from papers p
join students s on s.id = p.student_id
join teams t on t.id = s.team_id
left join coordinators isc on isc.id = p.initial_score_coordinator_id
left join coordinators asc_coordinator on asc_coordinator.id = p.agreed_score_coordinator_id
left join paper_claims pc on pc.paper_id = p.id and pc.released_at is null
left join coordinators cc on cc.id = pc.coordinator_id;

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
  v_existing_claim paper_claims%rowtype;
  v_claim_id uuid;
begin
  v_coordinator_id := require_current_coordinator_id();

  if not exists (select 1 from papers where id = p_paper_id) then
    raise exception 'Paper does not exist';
  end if;

  select *
  into v_existing_claim
  from paper_claims
  where paper_id = p_paper_id
    and released_at is null
  limit 1;

  if found then
    if v_existing_claim.coordinator_id = v_coordinator_id then
      return v_existing_claim.id;
    end if;
    raise exception 'Paper is already claimed';
  end if;

  insert into paper_claims (paper_id, coordinator_id)
  values (p_paper_id, v_coordinator_id)
  returning id into v_claim_id;

  return v_claim_id;
exception
  when unique_violation then
    raise exception 'Paper is already claimed';
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

  v_signature := nullif(trim(p_team_leader_signature), '');
  if v_signature is null then
    raise exception 'Team leader signature is required';
  end if;

  v_coordinator_id := require_current_coordinator_id();
  perform assert_active_claim(p_paper_id, v_coordinator_id);

  insert into agreed_score_history (paper_id, score, coordinator_id, team_leader_signature)
  values (p_paper_id, p_score::smallint, v_coordinator_id, v_signature);

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

  update papers
  set initial_score = null,
      initial_score_coordinator_id = null
  where id = p_paper_id;
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
  agreed_score_history_view
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
  agreed_score_history_view
to service_role;

grant execute on function current_coordinator_id() to service_role;
grant execute on function claim_paper(uuid) to service_role;
grant execute on function release_claim(uuid) to service_role;
grant execute on function submit_initial_score(uuid, integer) to service_role;
grant execute on function submit_agreed_score(uuid, integer, text) to service_role;
grant execute on function clear_initial_score(uuid) to service_role;
grant execute on function clear_agreed_score(uuid) to service_role;
grant execute on function update_avatar_seed(text) to service_role;
