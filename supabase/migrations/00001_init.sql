-- ============================================================================
-- OKR Tool — Migrazione iniziale
--
-- Da eseguire su un progetto Supabase (SQL Editor oppure `supabase db push`).
--
-- Principi di sicurezza applicati QUI, a livello di database:
--   1. Row Level Security attiva su ogni tabella: un membro non può MAI
--      leggere o scrivere righe che non gli appartengono, nemmeno con un
--      client API diretto che bypassa la UI.
--   2. La state machine (bozza → inviato → approvato → valutazione → chiuso)
--      è applicata da trigger BEFORE UPDATE: le transizioni illegali vengono
--      rifiutate dal DB, chiunque sia il chiamante.
--   3. La validazione "somma pesi = 100%" al submit e il calcolo dell'OKR
--      Result finale (media pesata) avvengono nel trigger, non nel client.
--   4. Audit log scritto da trigger/funzioni SECURITY DEFINER: l'app non può
--      dimenticarsi di loggare, e i membri non possono leggerlo/alterarlo.
--
-- Nota su auth.uid() IS NULL: le operazioni eseguite dal SQL Editor o con la
-- service_role key non hanno un utente autenticato. In quel caso i controlli
-- di IDENTITÀ vengono bypassati (serve per bootstrap/manutenzione), ma i
-- vincoli di INTEGRITÀ (pesi = 100, punteggi 0–120, calcolo finale) valgono
-- comunque.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tipi
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('member', 'manager');

create type public.okr_status as enum (
  'draft',              -- Bozza: il membro sta definendo gli obiettivi
  'submitted',          -- Inviato al manager per review
  'changes_requested',  -- Il manager ha richiesto modifiche
  'approved',           -- Obiettivi approvati e bloccati
  'evaluation',         -- Fase di valutazione di fine semestre
  'completed'           -- Valutato/chiuso: sola lettura, storico
);

-- ---------------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------------

-- Un solo team ("Marketing") in v1, ma la tabella esiste da subito così
-- aggiungere team/manager multipli in futuro non richiede un redesign.
create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

-- Un profilo per ogni utente auth. Creato automaticamente dal trigger
-- on_auth_user_created. Il ruolo di default è 'member': il primo manager
-- si promuove via SQL (vedi README).
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  team_id    uuid not null references public.teams (id),
  full_name  text not null default '',
  email      text not null,
  role       public.user_role not null default 'member',
  created_at timestamptz not null default now()
);

-- Semestri: "H1 2026", "H2 2026", ... Creati dal manager.
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

-- Il "set" di obiettivi di UN membro per UN semestre. Porta lo stato della
-- state machine e, a chiusura, l'OKR Result complessivo (media pesata).
create table public.okr_sets (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references public.profiles (id) on delete cascade,
  period_id           uuid not null references public.periods (id),
  status              public.okr_status not null default 'draft',
  final_score         numeric(6, 2),  -- OKR Result: calcolato dal trigger a chiusura
  submitted_at        timestamptz,
  approved_at         timestamptz,
  results_proposed_at timestamptz,    -- quando il membro ha proposto i risultati
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (profile_id, period_id)      -- un solo set per membro per semestre
);

-- I singoli obiettivi (Objective + Key Result) di un set.
-- Target/Result sono testo libero (es. "CPA < 140€"): il tipo metrica è un
-- campo libero e la % di raggiungimento può essere decisa manualmente.
create table public.objectives (
  id                 uuid primary key default gen_random_uuid(),
  set_id             uuid not null references public.okr_sets (id) on delete cascade,
  position           int  not null default 0,
  objective          text not null,                 -- es. "[Stellantis B2C] Growth - Quality target"
  key_result         text not null,                 -- es. "Lead Scoring"
  smart_requirements text not null default '',      -- SMART / requisiti di completamento
  starting_point     text not null default '',      -- valore di partenza
  target_outcome     text not null default '',      -- es. "Lead scoring 55 pts", "CPA < 140€"
  metric_type        text not null default '',      -- unità/tipo metrica, testo libero
  weight             numeric(5, 2) not null check (weight > 0 and weight <= 100),
  result_value       text,                          -- Result effettivo a fine semestre
  result_note        text,                          -- nota di contesto sul risultato
  proposed_score     numeric(5, 2) check (proposed_score >= 0 and proposed_score <= 120), -- % proposta dal membro
  final_score        numeric(5, 2) check (final_score  >= 0 and final_score  <= 120),     -- % confermata dal manager
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Feedback del manager (e note del membro): generale sul set
-- (objective_id NULL) o su un singolo obiettivo.
create table public.review_comments (
  id           uuid primary key default gen_random_uuid(),
  set_id       uuid not null references public.okr_sets (id) on delete cascade,
  objective_id uuid references public.objectives (id) on delete set null,
  author_id    uuid not null references public.profiles (id),
  body         text not null check (length(body) > 0),
  created_at   timestamptz not null default now()
);

-- Audit log minimale: chi ha fatto cosa, quando. Scritto SOLO da funzioni
-- SECURITY DEFINER (trigger e RPC), leggibile SOLO dal manager.
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
-- Funzioni helper (SECURITY DEFINER: bypassano RLS per evitare ricorsione
-- nelle policy; search_path fissato per sicurezza)
-- ---------------------------------------------------------------------------

-- L'utente corrente è il manager?
create or replace function public.is_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'manager'
  );
$$;

-- Team dell'utente corrente (per policy senza ricorsione su profiles).
create or replace function public.my_team_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select team_id from public.profiles where id = auth.uid();
$$;

-- Scrittura audit log (definer: i client normali non hanno INSERT su audit_log).
create or replace function public.log_audit(p_action text, p_set uuid, p_details jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = public
as $$
  insert into public.audit_log (actor_id, set_id, action, details)
  values (auth.uid(), p_set, p_action, p_details);
$$;

-- ---------------------------------------------------------------------------
-- Trigger: profilo automatico alla creazione dell'utente auth
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, team_id, full_name, email)
  values (
    new.id,
    (select id from public.teams order by created_at limit 1),  -- unico team in v1
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
-- Trigger: updated_at automatico
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
-- Trigger: protezione campi sensibili su profiles
-- (un membro può aggiornare solo il proprio full_name; ruolo/team/email no)
-- ---------------------------------------------------------------------------
create or replace function public.tg_profiles_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- auth.uid() IS NULL = SQL Editor / service_role: consentito (bootstrap manager)
  if auth.uid() is not null and not public.is_manager() then
    if new.role <> old.role or new.team_id <> old.team_id or new.email <> old.email then
      raise exception 'Solo il manager può modificare ruolo, team o email di un profilo';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- ---------------------------------------------------------------------------
-- Trigger: STATE MACHINE su okr_sets
--
-- Transizioni consentite (e da chi):
--   draft             → submitted   (membro proprietario; pesi = 100%)
--   changes_requested → submitted   (membro proprietario; pesi = 100%)
--   submitted         → approved    (manager)
--   submitted         → changes_requested (manager)
--   approved          → evaluation  (manager, apre la valutazione di fine semestre)
--   evaluation        → completed   (manager; tutte le % confermate → calcola OKR Result)
-- Qualsiasi altra transizione viene rifiutata.
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

  -- Campi mai modificabili direttamente dai client: vengono ripristinati e
  -- poi assegnati solo dal ramo di transizione pertinente.
  if new.profile_id <> old.profile_id or new.period_id <> old.period_id then
    raise exception 'Proprietario e periodo di un set OKR non sono modificabili';
  end if;

  -- Aggiornamenti senza cambio di stato -------------------------------------
  if new.status = old.status then
    if new.final_score  is distinct from old.final_score
       or new.submitted_at is distinct from old.submitted_at
       or new.approved_at  is distinct from old.approved_at
       or new.completed_at is distinct from old.completed_at then
      raise exception 'Questi campi sono gestiti automaticamente dal sistema';
    end if;
    -- Il membro può marcare "risultati proposti" solo in fase di valutazione
    if new.results_proposed_at is distinct from old.results_proposed_at
       and not (v_is_owner and old.status = 'evaluation') then
      raise exception 'La proposta dei risultati è consentita solo in fase di valutazione';
    end if;
    return new;
  end if;

  -- Transizioni di stato -----------------------------------------------------
  -- Ripristina i campi protetti: solo il ramo giusto li imposta.
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
    -- Validazione bloccante richiesta dalla spec: somma pesi = 100%
    if round(v_weight_sum, 2) <> 100.00 then
      raise exception 'La somma dei pesi deve essere il 100%% (attuale: % %%)', round(v_weight_sum, 2);
    end if;
    new.submitted_at := now();

  elsif old.status = 'submitted' and new.status = 'approved' then
    if not v_is_mgr then raise exception 'Solo il manager può approvare'; end if;
    new.approved_at := now();

  elsif old.status = 'submitted' and new.status = 'changes_requested' then
    if not v_is_mgr then raise exception 'Solo il manager può richiedere modifiche'; end if;

  elsif old.status = 'approved' and new.status = 'evaluation' then
    if not v_is_mgr then raise exception 'Solo il manager può aprire la fase di valutazione'; end if;

  elsif old.status = 'evaluation' and new.status = 'completed' then
    if not v_is_mgr then raise exception 'Solo il manager può confermare la valutazione finale'; end if;
    select count(*) into v_missing
      from public.objectives where set_id = old.id and final_score is null;
    if v_missing > 0 then
      raise exception 'Tutti gli obiettivi devono avere una %% confermata prima di chiudere il semestre';
    end if;
    -- OKR Result = media pesata delle % confermate (i pesi sommano a 100)
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

create trigger okr_sets_transition before update on public.okr_sets
  for each row execute function public.tg_okr_sets_transition();

-- ---------------------------------------------------------------------------
-- Trigger: chi può toccare QUALI campi degli obiettivi, in quale stato
--
--   membro, set in draft/changes_requested → campi di definizione
--                                            (punteggi/risultati vietati)
--   membro, set in evaluation              → solo result_value, result_note,
--                                            proposed_score
--   manager, set in evaluation             → solo result_value, result_note,
--                                            final_score (correzione/conferma)
--   qualsiasi altro caso                   → rifiutato
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
  -- Operazioni di sistema (SQL Editor, service_role, cascate da eliminazione
  -- utente): nessun controllo di permesso. I vincoli CHECK restano attivi.
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

  v_is_owner := (v_actor = v_owner);
  v_is_mgr   := public.is_manager();

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
    -- I campi di DEFINIZIONE sono bloccati per tutti dopo l'approvazione.
    if row(new.objective, new.key_result, new.smart_requirements, new.starting_point,
           new.target_outcome, new.metric_type, new.weight, new.position)
       is distinct from
       row(old.objective, old.key_result, old.smart_requirements, old.starting_point,
           old.target_outcome, old.metric_type, old.weight, old.position) then
      raise exception 'In fase di valutazione gli obiettivi non si modificano: solo risultati e %%';
    end if;

    -- Manager: conferma/correzione (final_score); la proposta del membro resta intatta.
    if v_is_mgr then
      if new.proposed_score is distinct from old.proposed_score and not v_is_owner then
        raise exception 'La %% proposta dal membro non è modificabile dal manager';
      end if;
      return new;
    end if;

    -- Membro: solo proposta (mai il punteggio confermato).
    if v_is_owner then
      if new.final_score is distinct from old.final_score then
        raise exception 'La %% confermata è riservata al manager';
      end if;
      return new;
    end if;
  end if;

  raise exception 'Modifica non consentita in questo stato';
end;
$$;

create trigger objectives_guard before insert or update or delete on public.objectives
  for each row execute function public.tg_objectives_guard();

-- ---------------------------------------------------------------------------
-- Trigger: AUDIT automatico (non dipende dalla buona volontà dell'app)
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

-- teams: tutti gli utenti autenticati vedono il proprio contesto team.
-- Nessuna policy di scrittura: si gestisce via SQL/service_role.
create policy teams_select on public.teams
  for select to authenticated
  using (true);

-- profiles:
--   SELECT: il proprio profilo; il manager vede tutti; i membri vedono anche
--           il profilo del manager del proprio team (serve per mostrare
--           l'autore dei feedback e inviare le notifiche email).
--           I membri NON vedono i profili degli altri membri.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_manager()
    or (role = 'manager' and team_id = public.my_team_id())
  );

--   UPDATE: solo il proprio profilo (il trigger profiles_guard impedisce ai
--           membri di cambiare ruolo/team/email: di fatto solo full_name).
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Nessuna policy INSERT/DELETE su profiles: creazione via trigger
-- handle_new_user (definer), cancellazione via cascade da auth.users.

-- periods: visibili a tutti gli autenticati; scrittura solo manager.
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

-- okr_sets: IL punto critico dell'isolamento dati.
--   SELECT: il membro vede SOLO i propri set; il manager vede tutti.
create policy okr_sets_select on public.okr_sets
  for select to authenticated
  using (profile_id = auth.uid() or public.is_manager());

--   INSERT: solo per sé stessi, solo in stato draft.
create policy okr_sets_insert on public.okr_sets
  for insert to authenticated
  with check (profile_id = auth.uid() and status = 'draft');

--   UPDATE: proprietario o manager; il trigger okr_sets_transition applica
--           la state machine (chi può fare quale transizione, quando).
create policy okr_sets_update on public.okr_sets
  for update to authenticated
  using (profile_id = auth.uid() or public.is_manager())
  with check (profile_id = auth.uid() or public.is_manager());

--   DELETE: solo il proprietario, solo una bozza mai inviata.
create policy okr_sets_delete on public.okr_sets
  for delete to authenticated
  using (profile_id = auth.uid() and status = 'draft');

-- objectives: visibilità/scrittura derivata dal set padre.
--   SELECT: proprietario del set o manager.
create policy objectives_select on public.objectives
  for select to authenticated
  using (
    exists (
      select 1 from public.okr_sets s
      where s.id = set_id
        and (s.profile_id = auth.uid() or public.is_manager())
    )
  );

--   INSERT/DELETE: solo il proprietario del set (lo stato giusto è
--   verificato dal trigger objectives_guard).
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

--   UPDATE: proprietario o manager (i campi ammessi li decide il trigger).
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
--   SELECT: manager o proprietario del set commentato.
create policy review_comments_select on public.review_comments
  for select to authenticated
  using (
    public.is_manager()
    or exists (select 1 from public.okr_sets s where s.id = set_id and s.profile_id = auth.uid())
  );

--   INSERT: come sé stessi; manager su qualsiasi set, membro solo sui propri.
create policy review_comments_insert on public.review_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and (
      public.is_manager()
      or exists (select 1 from public.okr_sets s where s.id = set_id and s.profile_id = auth.uid())
    )
  );

-- Nessun UPDATE/DELETE sui commenti: restano come traccia.

-- audit_log: sola lettura per il manager; scrittura solo via log_audit (definer).
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.is_manager());

-- ---------------------------------------------------------------------------
-- RPC (SECURITY INVOKER: RLS e trigger si applicano al chiamante; il valore
-- aggiunto è l'atomicità — tutto in una transazione)
-- ---------------------------------------------------------------------------

-- Salva la bozza sovrascrivendo la versione precedente (come da spec:
-- nessuno storico versioni, solo l'ultima; l'audit log tiene traccia
-- di submit/review). Consentito solo su set propri in draft/changes_requested
-- (RLS + trigger).
create or replace function public.save_objectives(p_set_id uuid, p_objectives jsonb)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_row jsonb;
  v_pos int := 0;
begin
  if jsonb_array_length(p_objectives) > 20 then
    raise exception 'Massimo 20 obiettivi per semestre';
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

-- Il membro propone i risultati di fine semestre (Result + % 0–120 + nota).
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

-- Il manager conferma/corregge Result e % per ogni obiettivo e chiude il
-- semestre: il trigger calcola l'OKR Result (media pesata) e lo restituisce.
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
-- Seed: unico team v1 + semestre corrente
-- ---------------------------------------------------------------------------
insert into public.teams (name) values ('Marketing');

insert into public.periods (team_id, label, starts_on, ends_on)
select id, 'H2 2026', date '2026-07-01', date '2026-12-31' from public.teams
where name = 'Marketing';
