-- ============================================================================
-- OKR Tool — Initial migration
--
-- Run this on a Supabase project (SQL Editor or `supabase db push`).
--
-- Security principles enforced HERE, at the database level:
--   1. Row Level Security enabled on every table: a member can NEVER read
--      or write rows that don't belong to them, even with a direct API
--      client that bypasses the UI.
--   2. The state machine (draft → submitted → approved → evaluation → closed)
--      is enforced by BEFORE UPDATE triggers: illegal transitions are
--      rejected by the DB, no matter who the caller is.
--   3. The "weights sum to 100%" validation on submit and the final OKR
--      Result calculation (weighted average) happen in the trigger, not
--      in the client.
--   4. Audit log written by SECURITY DEFINER triggers/functions: the app
--      can't forget to log, and members can't read/alter it.
--
-- Note on auth.uid() IS NULL: operations run from the SQL Editor or with
-- the service_role key have no authenticated user. In that case IDENTITY
-- checks are bypassed (needed for bootstrap/maintenance), but INTEGRITY
-- constraints (weights = 100, scores 0–120, final calculation) still apply.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('member', 'manager');

create type public.okr_status as enum (
  'draft',              -- Draft: the member is defining their objectives
  'submitted',          -- Sent to the manager for review
  'changes_requested',  -- The manager requested changes
  'approved',           -- Objectives approved and locked
  'evaluation',         -- End-of-semester evaluation phase
  'completed'           -- Evaluated/closed: read-only, historical
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Just one team ("Marketing") in v1, but the table exists from the start so
-- adding multiple teams/managers later doesn't require a redesign.
create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

-- One profile per auth user. Created automatically by the
-- on_auth_user_created trigger. Default role is 'member': the first
-- manager is promoted via SQL (see README).
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  team_id    uuid not null references public.teams (id),
  full_name  text not null default '',
  email      text not null,
  role       public.user_role not null default 'member',
  created_at timestamptz not null default now()
);

-- Semesters: "H1 2026", "H2 2026", ... Created by the manager.
create table public.periods (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id),
  label      text not null,
  starts_on  date not null,
  ends_on    date not null,
  created_at timestamptz not null default now(),
  unique (team_id, label),
  check (starts_on < ends_on)
);

-- The objective "set" of ONE member for ONE semester. Carries the state
-- machine's status and, once closed, the overall OKR Result (weighted average).
create table public.okr_sets (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references public.profiles (id) on delete cascade,
  period_id           uuid not null references public.periods (id),
  status              public.okr_status not null default 'draft',
  final_score         numeric(6, 2),  -- OKR Result: computed by the trigger on closing
  submitted_at        timestamptz,
  approved_at         timestamptz,
  results_proposed_at timestamptz,    -- when the member proposed their results
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (profile_id, period_id)      -- only one set per member per semester
);

-- The individual objectives (Objective + Key Result) of a set.
-- Target/Result are free text (e.g. "CPA < $140"): the metric type is a
-- free-form field and the % achieved can be decided manually.
create table public.objectives (
  id                 uuid primary key default gen_random_uuid(),
  set_id             uuid not null references public.okr_sets (id) on delete cascade,
  position           int  not null default 0,
  objective          text not null,                 -- e.g. "[Product Line] Growth - Quality target"
  key_result         text not null,                 -- e.g. "Lead Scoring"
  smart_requirements text not null default '',      -- SMART / completion requirements
  starting_point     text not null default '',      -- starting value
  target_outcome     text not null default '',      -- e.g. "Lead scoring 55 pts", "CPA < $140"
  metric_type        text not null default '',      -- unit/metric type, free text
  weight             numeric(5, 2) not null check (weight > 0 and weight <= 100),
  result_value       text,                          -- actual result at end of semester
  result_note        text,                          -- context note on the result
  proposed_score     numeric(5, 2) check (proposed_score >= 0 and proposed_score <= 120), -- % proposed by the member
  final_score        numeric(5, 2) check (final_score  >= 0 and final_score  <= 120),     -- % confirmed by the manager
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Manager feedback (and member notes): general on the set
-- (objective_id NULL) or on a single objective.
create table public.review_comments (
  id           uuid primary key default gen_random_uuid(),
  set_id       uuid not null references public.okr_sets (id) on delete cascade,
  objective_id uuid references public.objectives (id) on delete set null,
  author_id    uuid not null references public.profiles (id),
  body         text not null check (length(body) > 0),
  created_at   timestamptz not null default now()
);

-- Minimal audit log: who did what, when. Written ONLY by SECURITY DEFINER
-- functions (triggers and RPCs), readable ONLY by the manager.
create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid,
  set_id     uuid,
  action     text not null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index objectives_set_id_idx      on public.objectives (set_id);
create index okr_sets_period_id_idx     on public.okr_sets (period_id);
create index review_comments_set_id_idx on public.review_comments (set_id);
create index audit_log_set_id_idx       on public.audit_log (set_id);

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER: bypass RLS to avoid recursion in
-- policies; search_path fixed for security)
-- ---------------------------------------------------------------------------

-- Is the current user the manager?
create or replace function public.is_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'manager'
  );
$$;

-- Current user's team (for policies without recursion on profiles).
create or replace function public.my_team_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select team_id from public.profiles where id = auth.uid();
$$;

-- Audit log writer (definer: normal clients have no INSERT on audit_log).
create or replace function public.log_audit(p_action text, p_set uuid, p_details jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = public
as $$
  insert into public.audit_log (actor_id, set_id, action, details)
  values (auth.uid(), p_set, p_action, p_details);
$$;

-- ---------------------------------------------------------------------------
-- Trigger: automatic profile on auth user creation
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, team_id, full_name, email)
  values (
    new.id,
    (select id from public.teams order by created_at limit 1),  -- only team in v1
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Trigger: automatic updated_at
-- ---------------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger okr_sets_updated_at   before update on public.okr_sets   for each row execute function public.tg_set_updated_at();
create trigger objectives_updated_at before update on public.objectives for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Trigger: protection of sensitive fields on profiles
-- (a member can only update their own full_name; role/team/email are locked)
-- ---------------------------------------------------------------------------
create or replace function public.tg_profiles_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- auth.uid() IS NULL = SQL Editor / service_role: allowed (manager bootstrap)
  if auth.uid() is not null and not public.is_manager() then
    if new.role <> old.role or new.team_id <> old.team_id or new.email <> old.email then
      raise exception 'Only the manager can change a profile''s role, team, or email';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- ---------------------------------------------------------------------------
-- Trigger: STATE MACHINE on okr_sets
--
-- Allowed transitions (and who can make them):
--   draft             → submitted   (owning member; weights = 100%)
--   changes_requested → submitted   (owning member; weights = 100%)
--   submitted         → approved    (manager)
--   submitted         → changes_requested (manager)
--   approved          → evaluation  (manager, opens the end-of-semester evaluation)
--   evaluation        → completed   (manager; all % confirmed → computes OKR Result)
-- Any other transition is rejected.
-- ---------------------------------------------------------------------------
create or replace function public.tg_okr_sets_transition()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor      uuid    := auth.uid();
  v_bypass     boolean := (auth.uid() is null);  -- SQL Editor / service_role
  v_is_owner   boolean;
  v_is_mgr     boolean;
  v_count      int;
  v_weight_sum numeric;
  v_missing    int;
  v_score      numeric;
begin
  v_is_owner := v_bypass or (v_actor = old.profile_id);
  v_is_mgr   := v_bypass or public.is_manager();

  -- Fields never directly editable by clients: reset here and then set
  -- only by the relevant transition branch.
  if new.profile_id <> old.profile_id or new.period_id <> old.period_id then
    raise exception 'The owner and period of an OKR set cannot be changed';
  end if;

  -- Updates without a status change ------------------------------------
  if new.status = old.status then
    if new.final_score  is distinct from old.final_score
       or new.submitted_at is distinct from old.submitted_at
       or new.approved_at  is distinct from old.approved_at
       or new.completed_at is distinct from old.completed_at then
      raise exception 'These fields are managed automatically by the system';
    end if;
    -- The member can only mark "results proposed" during the evaluation phase
    if new.results_proposed_at is distinct from old.results_proposed_at
       and not (v_is_owner and old.status = 'evaluation') then
      raise exception 'Proposing results is only allowed during the evaluation phase';
    end if;
    return new;
  end if;

  -- State transitions -----------------------------------------------------
  -- Reset protected fields: only the right branch sets them.
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
    -- Blocking validation required by the spec: weights sum to 100%
    if round(v_weight_sum, 2) <> 100.00 then
      raise exception 'The sum of the weights must be 100%% (current: % %%)', round(v_weight_sum, 2);
    end if;
    new.submitted_at := now();

  elsif old.status = 'submitted' and new.status = 'approved' then
    if not v_is_mgr then raise exception 'Only the manager can approve'; end if;
    new.approved_at := now();

  elsif old.status = 'submitted' and new.status = 'changes_requested' then
    if not v_is_mgr then raise exception 'Only the manager can request changes'; end if;

  elsif old.status = 'approved' and new.status = 'evaluation' then
    if not v_is_mgr then raise exception 'Only the manager can open the evaluation phase'; end if;

  elsif old.status = 'evaluation' and new.status = 'completed' then
    if not v_is_mgr then raise exception 'Only the manager can confirm the final evaluation'; end if;
    select count(*) into v_missing
      from public.objectives where set_id = old.id and final_score is null;
    if v_missing > 0 then
      raise exception 'Every objective must have a confirmed %% before closing the semester';
    end if;
    -- OKR Result = weighted average of the confirmed % (weights sum to 100)
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

create trigger okr_sets_transition before update on public.okr_sets
  for each row execute function public.tg_okr_sets_transition();

-- ---------------------------------------------------------------------------
-- Trigger: who can touch WHICH objective fields, in which state
--
--   member, set in draft/changes_requested → definition fields
--                                            (scores/results forbidden)
--   member, set in evaluation              → only result_value, result_note,
--                                            proposed_score
--   manager, set in evaluation             → only result_value, result_note,
--                                            final_score (correction/confirmation)
--   any other case                         → rejected
-- ---------------------------------------------------------------------------
create or replace function public.tg_objectives_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor    uuid    := auth.uid();
  v_status   public.okr_status;
  v_owner    uuid;
  v_is_owner boolean;
  v_is_mgr   boolean;
begin
  -- System operations (SQL Editor, service_role, cascades from user
  -- deletion): no permission checks. CHECK constraints remain active.
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

  v_is_owner := (v_actor = v_owner);
  v_is_mgr   := public.is_manager();

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
    -- DEFINITION fields are locked for everyone after approval.
    if row(new.objective, new.key_result, new.smart_requirements, new.starting_point,
           new.target_outcome, new.metric_type, new.weight, new.position)
       is distinct from
       row(old.objective, old.key_result, old.smart_requirements, old.starting_point,
           old.target_outcome, old.metric_type, old.weight, old.position) then
      raise exception 'Objectives cannot be edited during evaluation: only results and %%';
    end if;

    -- Manager: confirmation/correction (final_score); the member's proposal stays intact.
    if v_is_mgr then
      if new.proposed_score is distinct from old.proposed_score and not v_is_owner then
        raise exception 'The %% proposed by the member cannot be changed by the manager';
      end if;
      return new;
    end if;

    -- Member: proposal only (never the confirmed score).
    if v_is_owner then
      if new.final_score is distinct from old.final_score then
        raise exception 'The confirmed %% is reserved to the manager';
      end if;
      return new;
    end if;
  end if;

  raise exception 'Change not allowed in this state';
end;
$$;

create trigger objectives_guard before insert or update or delete on public.objectives
  for each row execute function public.tg_objectives_guard();

-- ---------------------------------------------------------------------------
-- Trigger: automatic AUDIT (doesn't depend on the app remembering to log)
-- ---------------------------------------------------------------------------
create or replace function public.tg_audit_set_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status <> old.status then
    perform public.log_audit(
      'status_change', new.id,
      jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;
  return new;
end;
$$;

create trigger okr_sets_audit after update on public.okr_sets
  for each row execute function public.tg_audit_set_status();

create or replace function public.tg_audit_comment()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.log_audit(
    'comment_added', new.set_id,
    jsonb_build_object('comment_id', new.id, 'objective_id', new.objective_id)
  );
  return new;
end;
$$;

create trigger review_comments_audit after insert on public.review_comments
  for each row execute function public.tg_audit_comment();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table public.teams           enable row level security;
alter table public.profiles        enable row level security;
alter table public.periods         enable row level security;
alter table public.okr_sets        enable row level security;
alter table public.objectives      enable row level security;
alter table public.review_comments enable row level security;
alter table public.audit_log       enable row level security;

-- teams: all authenticated users see their own team context.
-- No write policy: managed via SQL/service_role.
create policy teams_select on public.teams
  for select to authenticated
  using (true);

-- profiles:
--   SELECT: your own profile; the manager sees everyone; members also see
--           their own team's manager profile (needed to show feedback
--           authors and send email notifications).
--           Members do NOT see other members' profiles.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_manager()
    or (role = 'manager' and team_id = public.my_team_id())
  );

--   UPDATE: only your own profile (the profiles_guard trigger prevents
--           members from changing role/team/email: effectively only full_name).
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No INSERT/DELETE policy on profiles: created via the handle_new_user
-- trigger (definer), deleted via cascade from auth.users.

-- periods: visible to all authenticated users; write access manager only.
create policy periods_select on public.periods
  for select to authenticated
  using (true);

create policy periods_insert on public.periods
  for insert to authenticated
  with check (public.is_manager());

create policy periods_update on public.periods
  for update to authenticated
  using (public.is_manager())
  with check (public.is_manager());

-- okr_sets: THE critical point of data isolation.
--   SELECT: a member sees ONLY their own sets; the manager sees everyone's.
create policy okr_sets_select on public.okr_sets
  for select to authenticated
  using (profile_id = auth.uid() or public.is_manager());

--   INSERT: only for yourself, only in draft status.
create policy okr_sets_insert on public.okr_sets
  for insert to authenticated
  with check (profile_id = auth.uid() and status = 'draft');

--   UPDATE: owner or manager; the okr_sets_transition trigger enforces
--           the state machine (who can make which transition, when).
create policy okr_sets_update on public.okr_sets
  for update to authenticated
  using (profile_id = auth.uid() or public.is_manager())
  with check (profile_id = auth.uid() or public.is_manager());

--   DELETE: owner only, only a draft that was never submitted.
create policy okr_sets_delete on public.okr_sets
  for delete to authenticated
  using (profile_id = auth.uid() and status = 'draft');

-- objectives: visibility/write access derived from the parent set.
--   SELECT: the set's owner or the manager.
create policy objectives_select on public.objectives
  for select to authenticated
  using (
    exists (
      select 1 from public.okr_sets s
      where s.id = set_id
        and (s.profile_id = auth.uid() or public.is_manager())
    )
  );

--   INSERT/DELETE: only the set's owner (the correct state is checked by
--   the objectives_guard trigger).
create policy objectives_insert on public.objectives
  for insert to authenticated
  with check (
    exists (select 1 from public.okr_sets s where s.id = set_id and s.profile_id = auth.uid())
  );

create policy objectives_delete on public.objectives
  for delete to authenticated
  using (
    exists (select 1 from public.okr_sets s where s.id = set_id and s.profile_id = auth.uid())
  );

--   UPDATE: owner or manager (the trigger decides which fields are allowed).
create policy objectives_update on public.objectives
  for update to authenticated
  using (
    exists (
      select 1 from public.okr_sets s
      where s.id = set_id
        and (s.profile_id = auth.uid() or public.is_manager())
    )
  )
  with check (
    exists (
      select 1 from public.okr_sets s
      where s.id = set_id
        and (s.profile_id = auth.uid() or public.is_manager())
    )
  );

-- review_comments:
--   SELECT: manager, or the owner of the commented-on set.
create policy review_comments_select on public.review_comments
  for select to authenticated
  using (
    public.is_manager()
    or exists (select 1 from public.okr_sets s where s.id = set_id and s.profile_id = auth.uid())
  );

--   INSERT: as yourself; manager on any set, member only on their own.
create policy review_comments_insert on public.review_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and (
      public.is_manager()
      or exists (select 1 from public.okr_sets s where s.id = set_id and s.profile_id = auth.uid())
    )
  );

-- No UPDATE/DELETE on comments: they stay as a record.

-- audit_log: read-only for the manager; written only via log_audit (definer).
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.is_manager());

-- ---------------------------------------------------------------------------
-- RPC (SECURITY INVOKER: RLS and triggers apply to the caller; the added
-- value here is atomicity — everything in one transaction)
-- ---------------------------------------------------------------------------

-- Saves the draft, overwriting the previous version (per spec: no version
-- history, only the latest; the audit log tracks submit/review). Only
-- allowed on your own sets in draft/changes_requested (RLS + trigger).
create or replace function public.save_objectives(p_set_id uuid, p_objectives jsonb)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_row jsonb;
  v_pos int := 0;
begin
  if jsonb_array_length(p_objectives) > 20 then
    raise exception 'Maximum 20 objectives per semester';
  end if;

  delete from public.objectives where set_id = p_set_id;

  for v_row in select * from jsonb_array_elements(p_objectives) loop
    v_pos := v_pos + 1;
    insert into public.objectives
      (set_id, position, objective, key_result, smart_requirements,
       starting_point, target_outcome, metric_type, weight)
    values
      (p_set_id, v_pos,
       v_row ->> 'objective',
       v_row ->> 'key_result',
       coalesce(v_row ->> 'smart_requirements', ''),
       coalesce(v_row ->> 'starting_point', ''),
       coalesce(v_row ->> 'target_outcome', ''),
       coalesce(v_row ->> 'metric_type', ''),
       (v_row ->> 'weight')::numeric);
  end loop;
end;
$$;

-- The member proposes their end-of-semester results (Result + % 0–120 + note).
create or replace function public.propose_results(p_set_id uuid, p_results jsonb)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_row jsonb;
begin
  for v_row in select * from jsonb_array_elements(p_results) loop
    update public.objectives
       set result_value   = v_row ->> 'result_value',
           result_note    = nullif(v_row ->> 'result_note', ''),
           proposed_score = (v_row ->> 'proposed_score')::numeric
     where id = (v_row ->> 'id')::uuid
       and set_id = p_set_id;
  end loop;

  update public.okr_sets set results_proposed_at = now() where id = p_set_id;

  perform public.log_audit('results_proposed', p_set_id, '{}'::jsonb);
end;
$$;

-- The manager confirms/corrects the Result and % for each objective and
-- closes the semester: the trigger computes the OKR Result (weighted
-- average) and returns it.
create or replace function public.finalize_evaluation(p_set_id uuid, p_scores jsonb)
returns numeric
language plpgsql security invoker set search_path = public
as $$
declare
  v_row   jsonb;
  v_score numeric;
begin
  for v_row in select * from jsonb_array_elements(p_scores) loop
    update public.objectives
       set result_value = v_row ->> 'result_value',
           result_note  = nullif(v_row ->> 'result_note', ''),
           final_score  = (v_row ->> 'final_score')::numeric
     where id = (v_row ->> 'id')::uuid
       and set_id = p_set_id;
  end loop;

  update public.okr_sets
     set status = 'completed'
   where id = p_set_id
  returning final_score into v_score;

  return v_score;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed: only v1 team + current semester
-- ---------------------------------------------------------------------------
insert into public.teams (name) values ('Marketing');

insert into public.periods (team_id, label, starts_on, ends_on)
select id, 'H2 2026', date '2026-07-01', date '2026-12-31' from public.teams
where name = 'Marketing';
