-- ============================================================================
-- REOPENING AN ALREADY-APPROVED SET.
--
-- Use case: OKRs get approved and presented now, but later on (e.g. early
-- in the semester) an objective needs fixing — removing one and rebalancing
-- the weights. With the original state machine, approval froze everything
-- and there was no way back into definition.
--
-- This migration adds a single backward transition:
--
--   approved → changes_requested   (manager ONLY)
--
-- From there the set becomes editable again for the owner exactly like in
-- "changes_requested": remove/add objectives and fix the weights, then
-- resubmit (the weights-sum-to-100% constraint still applies) → new approval.
-- Everything remains tracked in the audit log.
--
-- The function is redefined IN FULL (create or replace) so the live copy
-- stays the complete, readable source of truth.
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

  -- NEW: the manager can REOPEN an already-approved set for corrections
  -- (removing an objective, rebalancing weights). Clears the approval:
  -- a new approval will be needed after resubmission.
  elsif old.status = 'approved' and new.status = 'changes_requested' then
    if not v_is_mgr then raise exception 'Only the manager can reopen an approved set'; end if;
    new.approved_at := null;

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
