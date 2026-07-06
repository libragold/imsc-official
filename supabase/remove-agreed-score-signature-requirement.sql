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

grant execute on function submit_agreed_score(uuid, integer, text) to authenticated;
grant execute on function submit_agreed_score(uuid, integer, text) to service_role;

notify pgrst, 'reload schema';
