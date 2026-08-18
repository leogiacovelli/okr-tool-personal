-- ============================================================================
-- Read-only visibility for the 'viewer' role.
--
-- ONLY SELECT policies are widened: write policies and the state machine
-- triggers remain unchanged (manager/owner). A viewer cannot create, edit,
-- approve, or evaluate anything: any write attempt is rejected by the database.
--
-- The audit log remains readable exclusively by the manager.
-- ============================================================================

-- Can the current user see the whole team's data? (manager or viewer)
create or replace function public.can_view_team()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('manager', 'viewer')
  );
$$;

-- profiles: the viewer sees all of the team's profiles (names are needed
-- for the views). Members still see only themselves and the manager: to
-- them, the viewer isn't even visible.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.can_view_team()
    or (role = 'manager' and team_id = public.my_team_id())
  );

-- okr_sets: read access extended to manager + viewer; write unchanged.
drop policy if exists okr_sets_select on public.okr_sets;
create policy okr_sets_select on public.okr_sets
  for select to authenticated
  using (profile_id = auth.uid() or public.can_view_team());

-- objectives: read access derived from the parent set, extended to manager + viewer.
drop policy if exists objectives_select on public.objectives;
create policy objectives_select on public.objectives
  for select to authenticated
  using (
    exists (
      select 1 from public.okr_sets s
      where s.id = set_id
        and (s.profile_id = auth.uid() or public.can_view_team())
    )
  );

-- review_comments: the viewer reads feedback; cannot write any (the
-- INSERT policy remains manager/owner).
drop policy if exists review_comments_select on public.review_comments;
create policy review_comments_select on public.review_comments
  for select to authenticated
  using (
    public.can_view_team()
    or exists (select 1 from public.okr_sets s where s.id = set_id and s.profile_id = auth.uid())
  );
