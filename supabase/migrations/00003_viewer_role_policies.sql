-- ============================================================================
-- Visibilità di sola lettura per il ruolo 'viewer' (osservatore).
--
-- Vengono allargate SOLO le policy di SELECT: le policy di scrittura e i
-- trigger della state machine restano invariati (manager/proprietario).
-- Un osservatore non può creare, modificare, approvare o valutare nulla:
-- qualsiasi tentativo di scrittura è rifiutato dal database.
--
-- L'audit log resta leggibile esclusivamente dal manager.
-- ============================================================================

-- L'utente corrente può vedere i dati di tutto il team? (manager o viewer)
create or replace function public.can_view_team()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('manager', 'viewer')
  );
$$;

-- profiles: il viewer vede tutti i profili del team (servono i nomi per le
-- viste). I membri continuano a vedere solo sé stessi e il manager: per
-- loro l'osservatore non è nemmeno visibile.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.can_view_team()
    or (role = 'manager' and team_id = public.my_team_id())
  );

-- okr_sets: lettura estesa a manager + viewer; scrittura invariata.
drop policy if exists okr_sets_select on public.okr_sets;
create policy okr_sets_select on public.okr_sets
  for select to authenticated
  using (profile_id = auth.uid() or public.can_view_team());

-- objectives: lettura derivata dal set padre, estesa a manager + viewer.
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

-- review_comments: il viewer legge i feedback; non può scriverne (la policy
-- di INSERT resta manager/proprietario).
drop policy if exists review_comments_select on public.review_comments;
create policy review_comments_select on public.review_comments
  for select to authenticated
  using (
    public.can_view_team()
    or exists (select 1 from public.okr_sets s where s.id = set_id and s.profile_id = auth.uid())
  );
