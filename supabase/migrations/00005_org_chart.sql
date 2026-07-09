-- ============================================================================
-- ORGANIGRAMMA: team con manager e gerarchia.
--
-- Da questa migrazione approvazioni e visibilità derivano dalla STRUTTURA:
--   · ogni team ha un manager (manager_id) e può stare sotto un altro team
--     (parent_team_id);
--   · gli OKR di una persona li approva IL MANAGER DEL SUO TEAM;
--   · un manager AGISCE solo sul proprio team e LEGGE tutto il sottoalbero;
--   · tra rami paralleli (es. Marketing e Vendite) non c'è alcuna visibilità.
--
-- I ruoli globali su profiles cambiano significato:
--   'manager' → ADMIN: amministra periodi, account, ruoli e organigramma,
--               e legge tutto. NON dà più diritti di approvazione: quelli
--               vengono solo dall'essere manager_id di un team.
--   'viewer'  → osservatore globale: legge tutto, non tocca nulla.
--   'member'  → vede solo i propri OKR (+ il proprio approvatore).
--
-- Dati: viene creato il team "Direzione Marketing" (manager: l'attuale
-- osservatrice) sopra a "Marketing" (manager: l'attuale admin), e l'admin
-- viene spostato come membro della Direzione → i suoi OKR li approva lei.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Struttura
-- ---------------------------------------------------------------------------
alter table public.teams add column if not exists manager_id uuid references public.profiles (id);
alter table public.teams add column if not exists parent_team_id uuid references public.teams (id);
alter table public.teams add constraint teams_not_own_parent
  check (parent_team_id is null or parent_team_id <> id);

-- ---------------------------------------------------------------------------
-- 2. Funzioni gerarchia (SECURITY DEFINER: niente ricorsione RLS)
-- ---------------------------------------------------------------------------

-- Admin globale (ruolo storico 'manager').
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'manager');
$$;

-- Osservatore globale.
create or replace function public.is_global_viewer()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'viewer');
$$;

-- Chi approva i MIEI OKR: il manager del team a cui appartengo.
create or replace function public.my_approver()
returns uuid
language sql stable security definer set search_path = public
as $$
  select t.manager_id
    from public.profiles p
    join public.teams t on t.id = p.team_id
   where p.id = auth.uid();
$$;

-- Sono io il manager del team di p_profile? (= posso approvare i suoi OKR)
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

-- p_profile appartiene a un team nel SOTTOALBERO dei team che gestisco?
-- (= lo leggo, in sola lettura se non è il mio team diretto)
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

-- Posso LEGGERE il profilo/gli OKR di p_profile?
create or replace function public.can_read_profile(p_profile uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_profile = auth.uid()
      or public.is_admin()
      or public.is_global_viewer()
      or public.in_managed_subtree(p_profile)
      or p_profile = public.my_approver();  -- il membro vede il suo approvatore
$$;

-- Ridefinita: accesso alle pagine di team (admin, viewer, o manager di team).
create or replace function public.can_view_team()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin()
      or public.is_global_viewer()
      or exists (select 1 from public.teams where manager_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- 3. Policy RLS riscritte sulla gerarchia
-- ---------------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (public.can_read_profile(id));

drop policy if exists okr_sets_select on public.okr_sets;
create policy okr_sets_select on public.okr_sets
  for select to authenticated
  using (public.can_read_profile(profile_id));

-- Scrittura: proprietario, oppure manager DIRETTO del team del proprietario.
-- (admin e viewer NON scrivono; il sottoalbero è sola lettura)
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

-- teams: struttura modificabile solo dall'admin.
create policy teams_insert on public.teams
  for insert to authenticated
  with check (public.is_admin());

create policy teams_update on public.teams
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. Trigger: la state machine ora usa l'organigramma
--    (reviewer = manager del team del proprietario; auth.uid() NULL bypassa
--    i controlli di identità ma non quelli di integrità)
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
    raise exception 'Proprietario e periodo di un set OKR non sono modificabili';
  end if;

  if new.status = old.status then
    if new.final_score  is distinct from old.final_score
       or new.submitted_at is distinct from old.submitted_at
       or new.approved_at  is distinct from old.approved_at
       or new.completed_at is distinct from old.completed_at then
      raise exception 'Questi campi sono gestiti automaticamente dal sistema';
    end if;
    if new.results_proposed_at is distinct from old.results_proposed_at
       and not (v_is_owner and old.status = 'evaluation') then
      raise exception 'La proposta dei risultati è consentita solo in fase di valutazione';
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
      raise exception 'Solo il proprietario può inviare i propri obiettivi';
    end if;
    select count(*), coalesce(sum(weight), 0)
      into v_count, v_weight_sum
      from public.objectives where set_id = old.id;
    if v_count = 0 then
      raise exception 'Aggiungi almeno un obiettivo prima di inviare';
    end if;
    if round(v_weight_sum, 2) <> 100.00 then
      raise exception 'La somma dei pesi deve essere il 100%% (attuale: % %%)', round(v_weight_sum, 2);
    end if;
    new.submitted_at := now();

  elsif old.status = 'submitted' and new.status = 'approved' then
    if not v_is_reviewer then raise exception 'Solo il manager del team può approvare'; end if;
    new.approved_at := now();

  elsif old.status = 'submitted' and new.status = 'changes_requested' then
    if not v_is_reviewer then raise exception 'Solo il manager del team può richiedere modifiche'; end if;

  elsif old.status = 'approved' and new.status = 'evaluation' then
    if not v_is_reviewer then raise exception 'Solo il manager del team può aprire la valutazione'; end if;

  elsif old.status = 'evaluation' and new.status = 'completed' then
    if not v_is_reviewer then raise exception 'Solo il manager del team può confermare la valutazione'; end if;
    select count(*) into v_missing
      from public.objectives where set_id = old.id and final_score is null;
    if v_missing > 0 then
      raise exception 'Tutti gli obiettivi devono avere una %% confermata prima di chiudere il semestre';
    end if;
    select round(sum(weight * final_score) / nullif(sum(weight), 0), 2)
      into v_score
      from public.objectives where set_id = old.id;
    new.final_score  := v_score;
    new.completed_at := now();

  else
    raise exception 'Transizione di stato non consentita: % → %', old.status, new.status;
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
  -- Operazioni di sistema: nessun controllo di permesso (CHECK sempre attivi).
  if v_actor is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select s.status, s.profile_id into v_status, v_owner
    from public.okr_sets s
   where s.id = coalesce(new.set_id, old.set_id);

  if v_status is null then
    raise exception 'Set OKR inesistente';
  end if;

  v_is_owner    := (v_actor = v_owner);
  v_is_reviewer := public.manages_team_of(v_owner);

  if tg_op = 'INSERT' then
    if v_is_owner and v_status in ('draft', 'changes_requested') then
      if new.result_value is not null or new.result_note is not null
         or new.proposed_score is not null or new.final_score is not null then
        raise exception 'Risultati e punteggi non si impostano in fase di definizione';
      end if;
      return new;
    end if;
    raise exception 'Non puoi aggiungere obiettivi in questo stato';
  end if;

  if tg_op = 'DELETE' then
    if v_is_owner and v_status in ('draft', 'changes_requested') then
      return old;
    end if;
    raise exception 'Non puoi eliminare obiettivi in questo stato';
  end if;

  -- UPDATE
  if new.set_id <> old.set_id then
    raise exception 'Un obiettivo non può cambiare set';
  end if;

  if v_is_owner and v_status in ('draft', 'changes_requested') then
    if new.result_value is distinct from old.result_value
       or new.result_note is distinct from old.result_note
       or new.proposed_score is distinct from old.proposed_score
       or new.final_score is distinct from old.final_score then
      raise exception 'Risultati e punteggi non si modificano in fase di definizione';
    end if;
    return new;
  end if;

  if v_status = 'evaluation' then
    if row(new.objective, new.key_result, new.smart_requirements, new.starting_point,
           new.target_outcome, new.metric_type, new.weight, new.position)
       is distinct from
       row(old.objective, old.key_result, old.smart_requirements, old.starting_point,
           old.target_outcome, old.metric_type, old.weight, old.position) then
      raise exception 'In fase di valutazione gli obiettivi non si modificano: solo risultati e %%';
    end if;

    -- Il manager del team conferma/corregge; la proposta del membro resta sua.
    if v_is_reviewer then
      if new.proposed_score is distinct from old.proposed_score and not v_is_owner then
        raise exception 'La %% proposta dal membro non è modificabile dal reviewer';
      end if;
      return new;
    end if;

    if v_is_owner then
      if new.final_score is distinct from old.final_score then
        raise exception 'La %% confermata è riservata al manager del team';
      end if;
      return new;
    end if;
  end if;

  raise exception 'Modifica non consentita in questo stato';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Dati: gerarchia iniziale
--    Direzione Marketing (manager: l'osservatrice) → Marketing (manager: admin)
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
  values ('Direzione Marketing', v_viewer)
  returning id into v_dir;

  update public.teams
     set manager_id = v_admin, parent_team_id = v_dir
   where id = v_mkt;

  -- L'admin e l'osservatrice appartengono alla Direzione: gli OKR dell'admin
  -- li approva il manager della Direzione (l'osservatrice).
  if v_admin  is not null then update public.profiles set team_id = v_dir where id = v_admin;  end if;
  if v_viewer is not null then update public.profiles set team_id = v_dir where id = v_viewer; end if;
end $$;
