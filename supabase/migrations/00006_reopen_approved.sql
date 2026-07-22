-- ============================================================================
-- RIAPERTURA DI UN SET GIÀ APPROVATO.
--
-- Caso d'uso: gli OKR vengono approvati e presentati adesso, ma più avanti
-- (es. a inizio semestre) va corretto un obiettivo — eliminarne uno e
-- ribilanciare i pesi. Con la state machine originale l'approvazione
-- congelava tutto e non c'era modo di rientrare in definizione.
--
-- Questa migrazione aggiunge una sola transizione all'indietro:
--
--   approved → changes_requested   (SOLO il manager)
--
-- Da lì il set torna editabile per il proprietario esattamente come in
-- "changes_requested": elimina/aggiunge obiettivi e sistema i pesi, poi
-- reinvia (il vincolo somma pesi = 100% resta bloccante) → nuova approvazione.
-- Tutto resta tracciato nell'audit log.
--
-- La funzione viene ridefinita PER INTERO (create or replace) così che la
-- copia live resti la fonte di verità completa e leggibile.
-- ============================================================================

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

  -- NUOVO: il manager può RIAPRIRE un set già approvato per correzioni
  -- (eliminare un obiettivo, ribilanciare i pesi). Azzera l'approvazione:
  -- servirà una nuova approvazione dopo il reinvio.
  elsif old.status = 'approved' and new.status = 'changes_requested' then
    if not v_is_mgr then raise exception 'Solo il manager può riaprire un set approvato'; end if;
    new.approved_at := null;

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
