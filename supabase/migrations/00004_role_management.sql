-- ============================================================================
-- Role management from the UI (Members page, manager only).
--
-- 1. The UPDATE policy on profiles is widened: besides their own profile,
--    the manager can update other people's profiles (to assign roles).
--    The profiles_guard trigger still prevents non-managers from touching
--    role/team/email.
-- 2. The trigger is hardened: the role can't be taken away from the LAST
--    manager in the system (otherwise no one could administer it anymore).
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
  -- SQL Editor / service_role: allowed (bootstrap and maintenance)
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_manager() then
    if new.role <> old.role or new.team_id <> old.team_id or new.email <> old.email then
      raise exception 'Only the manager can change a profile''s role, team, or email';
    end if;
    return new;
  end if;

  -- Protection: the system can't be left without a manager.
  if old.role = 'manager' and new.role <> 'manager' then
    if not exists (
      select 1 from public.profiles
      where role = 'manager' and id <> old.id
    ) then
      raise exception 'You cannot remove the last manager: promote someone else first';
    end if;
  end if;

  return new;
end;
$$;
