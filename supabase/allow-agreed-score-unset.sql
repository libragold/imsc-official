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

grant execute on function clear_agreed_score(uuid) to authenticated;
grant execute on function clear_agreed_score(uuid) to service_role;
