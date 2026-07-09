-- ============================================================================
-- Gestione ruoli dalla UI (pagina Membri, solo manager).
--
-- 1. La policy di UPDATE su profiles viene estesa: oltre al proprio profilo,
--    il manager può aggiornare i profili altrui (per assegnare i ruoli).
--    Il trigger profiles_guard continua a impedire ai NON manager di toccare
--    ruolo/team/email.
-- 2. Il trigger viene rafforzato: non si può togliere il ruolo all'ULTIMO
--    manager del sistema (altrimenti nessuno potrebbe più amministrare).
-- ============================================================================

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_manager())
  with check (id = auth.uid() or public.is_manager());

create or replace function public.tg_profiles_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- SQL Editor / service_role: consentito (bootstrap e manutenzione)
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_manager() then
    if new.role <> old.role or new.team_id <> old.team_id or new.email <> old.email then
      raise exception 'Solo il manager può modificare ruolo, team o email di un profilo';
    end if;
    return new;
  end if;

  -- Protezione: il sistema non può restare senza manager.
  if old.role = 'manager' and new.role <> 'manager' then
    if not exists (
      select 1 from public.profiles
      where role = 'manager' and id <> old.id
    ) then
      raise exception 'Non puoi rimuovere l''ultimo manager: prima promuovi qualcun altro';
    end if;
  end if;

  return new;
end;
$$;
