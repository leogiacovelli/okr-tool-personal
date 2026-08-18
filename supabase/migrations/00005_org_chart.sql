-- ============================================================================
-- ORG CHART: teams with a manager and hierarchy.
--
-- From this migration on, approvals and visibility derive from the STRUCTURE:
--   · every team has a manager (manager_id) and can sit under another team
--     (parent_team_id);
--   · a person's OKRs are approved by THE MANAGER OF THEIR TEAM;
--   · a manager ACTS only on their own team and READS the whole subtree;
--   · there is no visibility at all between parallel branches (e.g.
--     Marketing and Sales).
--
-- Global roles on profiles change meaning:
--   'manager' → ADMIN: administers periods, accounts, roles, and the org
--               chart, and reads everything. No longer grants approval
--               rights on its own: those come only from being a team's
--               manager_id.
--   'viewer'  → global observer: reads everything, touches nothing.
--   'member'  → sees only their own OKRs (+ their approver).
--
-- Data: creates the "Marketing Leadership" team (manager: the current
-- viewer) above "Marketing" (manager: the current admin), and moves the
-- admin into Marketing Leadership as a member → their OKRs are then
-- approved by the viewer.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Structure
-- ---------------------------------------------------------------------------
alter table public.teams add column if not exists manager_id uuid references public.profiles (id);
alter table public.teams add column if not exists parent_team_id uuid references public.teams (id);
alter table public.teams add constraint teams_not_own_parent
  check (parent_team_id is null or parent_team_id <> id);

-- ---------------------------------------------------------------------------
-- 2. Hierarchy functions (SECURITY DEFINER: no RLS recursion)
-- ---------------------------------------------------------------------------

-- Global admin (historical role 'manager').
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'manager');
$$;

-- Global viewer.
create or replace function public.is_global_viewer()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'viewer');
$$;

-- Who approves MY OKRs: the manager of the team I belong to.
create or replace function public.my_approver()
returns uuid
language sql stable security definer set search_path = public
as $$
  select t.manager_id
    from public.profiles p
    join public.teams t on t.id = p.team_id
   where p.id = auth.uid();
$$;

-- Am I the manager of p_profile's team? (= can I approve their OKRs)
create or replace function public.manages_team_of(p_profile uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
      join public.teams t on t.id = p.team_id
     where p.id = p_profile and t.manager_id = auth.uid()
  );
$$;

-- Does p_profile belong to a team in the SUBTREE of teams I manage?
-- (= I can read it, read-only if it isn't my direct team)
create or replace function public.in_managed_subtree(p_profile uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  with recursive managed as (
    select id from public.teams where manager_id = auth.uid()
    union
    select t.id from public.teams t join managed m on t.parent_team_id = m.id
  )
  select exists (
    select 1 from public.profiles p join managed m on m.id = p.team_id
    where p.id = p_profile
  );
$$;

-- Can I READ p_profile's profile/OKRs?
create or replace function public.can_read_profile(p_profile uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_profile = auth.uid()
      or public.is_admin()
      or public.is_global_viewer()
      or public.in_managed_subtree(p_profile)
      or p_profile = public.my_approver();  -- a member can see their approver
$$;

-- Redefined: access to team pages (admin, viewer, or team manager).
create or replace function public.can_view_team()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin()
      or public.is_global_viewer()
      or exists (select 1 from public.teams where manager_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- 3. RLS policies rewritten around the hierarchy
-- ---------------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (public.can_read_profile(id));

drop policy if exists okr_sets_select on public.okr_sets;
create policy okr_sets_select on public.okr_sets
  for select to authenticated
  using (public.can_read_profile(profile_id));

-- Write access: the owner, or the DIRECT manager of the owner's team.
-- (admin and viewer do NOT write; the subtree is read-only)
drop policy if exists okr_sets_update on public.okr_sets;
create policy okr_sets_update on public.okr_sets
  for update to authenticated
  using (profile_id = auth.uid() or public.manages_team_of(profile_id))
  with check (profile_id = auth.uid() or public.manages_team_of(profile_id));

drop policy if exists objectives_select on public.objectives;
create policy objectives_select on public.objectives
  for select to authenticated
  using (
    exists (
      select 1 from public.okr_sets s
      where s.id = set_id and public.can_read_profile(s.profile_id)
    )
  );

drop policy if exists objectives_update on public.objectives;
create policy objectives_update on public.objectives
  for update to authenticated
  using (
    exists (
      select 1 from public.okr_sets s
      where s.id = set_id
        and (s.profile_id = auth.uid() or public.manages_team_of(s.profile_id))
    )
  )
  with check (
    exists (
      select 1 from public.okr_sets s
      where s.id = set_id
        and (s.profile_id = auth.uid() or public.manages_team_of(s.profile_id))
    )
  );

drop policy if exists review_comments_select on public.review_comments;
create policy review_comments_select on public.review_comments
  for select to authenticated
  using (
    exists (
      select 1 from public.okr_sets s
      where s.id = set_id and public.can_read_profile(s.profile_id)
    )
  );

drop policy if exists review_comments_insert on public.review_comments;
create policy review_comments_insert on public.review_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.okr_sets s
      where s.id = set_id
        and (s.profile_id = auth.uid() or public.manages_team_of(s.profile_id))
    )
  );

-- teams: structure editable only by the admin.
create policy teams_insert on public.teams
  for insert to authenticated
  with check (public.is_admin());

create policy teams_update on public.teams
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. Trigger: the state machine now uses the org chart
--    (reviewer = the owner's team manager; auth.uid() NULL bypasses
--    identity checks but not integrity checks)
-- ---------------------------------------------------------------------------
create or replace function public.tg_okr_sets_transition()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor       uuid    := auth.uid();
  v_bypass      boolean := (auth.uid() is null);
  v_is_owner    boolean;
  v_is_reviewer boolean;
  v_count       int;
  v_weight_sum  numeric;
  v_missing     int;
  v_score       numeric;
begin
  v_is_owner    := v_bypass or (v_actor = old.profile_id);
  v_is_reviewer := v_bypass or public.manages_team_of(old.profile_id);

  if new.profile_id <> old.profile_id or new.period_id <> old.period_id then
    raise exception 'The owner and period of an OKR set cannot be changed';
  end if;

  if new.status = old.status then
    if new.final_score  is distinct from old.final_score
       or new.submitted_at is distinct from old.submitted_at
       or new.approved_at  is distinct from old.approved_at
       or new.completed_at is distinct from old.completed_at then
      raise exception 'These fields are managed automatically by the system';
    end if;
    if new.results_proposed_at is distinct from old.results_proposed_at
       and not (v_is_owner and old.status = 'evaluation') then
      raise exception 'Proposing results is only allowed during the evaluation phase';
    end if;
    return new;
  end if;

  new.final_score         := old.final_score;
  new.submitted_at        := old.submitted_at;
  new.approved_at         := old.approved_at;
  new.completed_at        := old.completed_at;
  new.results_proposed_at := old.results_proposed_at;

  if old.status in ('draft', 'changes_requested') and new.status = 'submitted' then
    if not v_is_owner then
      raise exception 'Only the owner can submit their own objectives';
    end if;
    select count(*), coalesce(sum(weight), 0)
      into v_count, v_weight_sum
      from public.objectives where set_id = old.id;
    if v_count = 0 then
      raise exception 'Add at least one objective before submitting';
    end if;
    if round(v_weight_sum, 2) <> 100.00 then
      raise exception 'The sum of the weights must be 100%% (current: % %%)', round(v_weight_sum, 2);
    end if;
    new.submitted_at := now();

  elsif old.status = 'submitted' and new.status = 'approved' then
    if not v_is_reviewer then raise exception 'Only the team manager can approve'; end if;
    new.approved_at := now();

  elsif old.status = 'submitted' and new.status = 'changes_requested' then
    if not v_is_reviewer then raise exception 'Only the team manager can request changes'; end if;

  elsif old.status = 'approved' and new.status = 'evaluation' then
    if not v_is_reviewer then raise exception 'Only the team manager can open the evaluation'; end if;

  elsif old.status = 'evaluation' and new.status = 'completed' then
    if not v_is_reviewer then raise exception 'Only the team manager can confirm the evaluation'; end if;
    select count(*) into v_missing
      from public.objectives where set_id = old.id and final_score is null;
    if v_missing > 0 then
      raise exception 'Every objective must have a confirmed %% before closing the semester';
    end if;
    select round(sum(weight * final_score) / nullif(sum(weight), 0), 2)
      into v_score
      from public.objectives where set_id = old.id;
    new.final_score  := v_score;
    new.completed_at := now();

  else
    raise exception 'State transition not allowed: % → %', old.status, new.status;
  end if;

  return new;
end;
$$;

create or replace function public.tg_objectives_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor       uuid := auth.uid();
  v_status      public.okr_status;
  v_owner       uuid;
  v_is_owner    boolean;
  v_is_reviewer boolean;
begin
  -- System operations: no permission checks (CHECK constraints always active).
  if v_actor is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select s.status, s.profile_id into v_status, v_owner
    from public.okr_sets s
   where s.id = coalesce(new.set_id, old.set_id);

  if v_status is null then
    raise exception 'OKR set does not exist';
  end if;

  v_is_owner    := (v_actor = v_owner);
  v_is_reviewer := public.manages_team_of(v_owner);

  if tg_op = 'INSERT' then
    if v_is_owner and v_status in ('draft', 'changes_requested') then
      if new.result_value is not null or new.result_note is not null
         or new.proposed_score is not null or new.final_score is not null then
        raise exception 'Results and scores cannot be set during the definition phase';
      end if;
      return new;
    end if;
    raise exception 'You cannot add objectives in this state';
  end if;

  if tg_op = 'DELETE' then
    if v_is_owner and v_status in ('draft', 'changes_requested') then
      return old;
    end if;
    raise exception 'You cannot delete objectives in this state';
  end if;

  -- UPDATE
  if new.set_id <> old.set_id then
    raise exception 'An objective cannot change set';
  end if;

  if v_is_owner and v_status in ('draft', 'changes_requested') then
    if new.result_value is distinct from old.result_value
       or new.result_note is distinct from old.result_note
       or new.proposed_score is distinct from old.proposed_score
       or new.final_score is distinct from old.final_score then
      raise exception 'Results and scores cannot be changed during the definition phase';
    end if;
    return new;
  end if;

  if v_status = 'evaluation' then
    if row(new.objective, new.key_result, new.smart_requirements, new.starting_point,
           new.target_outcome, new.metric_type, new.weight, new.position)
       is distinct from
       row(old.objective, old.key_result, old.smart_requirements, old.starting_point,
           old.target_outcome, old.metric_type, old.weight, old.position) then
      raise exception 'Objectives cannot be edited during evaluation: only results and %%';
    end if;

    -- The team manager confirms/corrects; the member's proposal stays theirs.
    if v_is_reviewer then
      if new.proposed_score is distinct from old.proposed_score and not v_is_owner then
        raise exception 'The %% proposed by the member cannot be changed by the reviewer';
      end if;
      return new;
    end if;

    if v_is_owner then
      if new.final_score is distinct from old.final_score then
        raise exception 'The confirmed %% is reserved to the team manager';
      end if;
      return new;
    end if;
  end if;

  raise exception 'Change not allowed in this state';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Data: initial hierarchy
--    Marketing Leadership (manager: the viewer) → Marketing (manager: admin)
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin  uuid;
  v_viewer uuid;
  v_mkt    uuid;
  v_dir    uuid;
begin
  select id into v_admin  from public.profiles where role = 'manager' order by created_at limit 1;
  select id into v_viewer from public.profiles where role = 'viewer'  order by created_at limit 1;
  select id into v_mkt    from public.teams    where name = 'Marketing' limit 1;

  insert into public.teams (name, manager_id)
  values ('Marketing Leadership', v_viewer)
  returning id into v_dir;

  update public.teams
     set manager_id = v_admin, parent_team_id = v_dir
   where id = v_mkt;

  -- The admin and the viewer belong to Marketing Leadership: the admin's
  -- OKRs are approved by Marketing Leadership's manager (the viewer).
  if v_admin  is not null then update public.profiles set team_id = v_dir where id = v_admin;  end if;
  if v_viewer is not null then update public.profiles set team_id = v_dir where id = v_viewer; end if;
end $$;
