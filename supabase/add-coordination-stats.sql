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

grant select on
  coordination_stats_coordinators,
  coordination_stats_countries,
  coordination_stats_problems
to authenticated;

grant select on
  coordination_stats_coordinators,
  coordination_stats_countries,
  coordination_stats_problems
to service_role;
