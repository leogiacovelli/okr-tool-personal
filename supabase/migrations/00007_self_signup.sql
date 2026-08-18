-- ============================================================================
-- SELF SIGN-UP WITH A COMPANY DOMAIN FILTER.
--
-- Context: the tool is being rolled out from 7 to ~25 people (the whole
-- company). Creating accounts by hand and distributing temporary passwords
-- doesn't scale, so self sign-up is reopened — but only for people with a
-- company email address.
--
-- Two things, both in the handle_new_user trigger (which intercepts EVERY
-- new user, so the check can't be bypassed from the client):
--
-- 1. DOMAIN FILTER: sign-up is only allowed for
--       @yourcompany.com · @secondbrand.com · @thirdbrand.com
--    Anyone trying with another address gets an error and the auth user is
--    NOT created (the exception rolls back the insert on auth.users).
--    NB: accounts created by an admin (SQL Editor / service_role / Supabase
--    dashboard) don't go through the filter: they're always possible, even
--    with other domains (e.g. a backup admin on gmail).
--
-- 2. LANDING TEAM: until now the trigger assigned "the first team created"
--    (a leftover from the single-team v1) — which today is Marketing
--    Leadership. With self sign-up, everyone would end up there, inheriting
--    the wrong approver. New sign-ups instead land in a holding team
--    "Awaiting assignment" (no manager: nobody approves them until you sort
--    them from the Members page).
-- ============================================================================

-- Holding team for new sign-ups. No manager_id and no parent: stays outside
-- the org chart until people are assigned.
insert into public.teams (name)
select 'Awaiting assignment'
where not exists (
  select 1 from public.teams where name = 'Awaiting assignment'
);

-- Company email domains allowed for self sign-up.
create or replace function public.is_allowed_signup_domain(p_email text)
returns boolean
language sql immutable
as $$
  select lower(coalesce(p_email, '')) ~
         '@(yourcompany\.com|secondbrand\.com|thirdbrand\.com)$';
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_team uuid;
begin
  -- Domain filter: applies ONLY to self sign-up. Accounts created by an
  -- admin (auth.uid() is null: SQL Editor, service_role, Supabase
  -- dashboard) remain unrestricted.
  if auth.uid() is null and not public.is_allowed_signup_domain(new.email) then
    raise exception 'Sign-up is only allowed with a company email address (@yourcompany.com, @secondbrand.com, @thirdbrand.com)';
  end if;

  -- New sign-ups land in the holding team, not the first team created
  -- (which is Marketing Leadership). Fallback: first team, in case the
  -- holding team was renamed/deleted.
  select id into v_team
    from public.teams where name = 'Awaiting assignment' limit 1;
  if v_team is null then
    select id into v_team from public.teams order by created_at limit 1;
  end if;

  insert into public.profiles (id, team_id, full_name, email)
  values (
    new.id,
    v_team,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, '')
  );
  return new;
end;
$$;
