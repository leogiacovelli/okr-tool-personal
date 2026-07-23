-- ============================================================================
-- AUTO-REGISTRAZIONE CON FILTRO SUI DOMINI AZIENDALI.
--
-- Contesto: il tool viene esteso da 7 a ~25 persone (tutta l'azienda). Creare
-- gli account a mano e distribuire password provvisorie non regge a quella
-- scala, quindi si riaprono i signup autonomi — ma solo per chi ha un indirizzo
-- di posta aziendale.
--
-- Due cose, entrambe nel trigger handle_new_user (che intercetta OGNI nuovo
-- utente, quindi il controllo non è aggirabile dal client):
--
-- 1. FILTRO DOMINI: la registrazione è consentita solo a
--       @tuaazienda.com · @secondobrand.com · @terzobrand.com
--    Chi prova con un altro indirizzo riceve un errore e l'utente auth NON
--    viene creato (l'eccezione fa rollback dell'insert su auth.users).
--    NB: gli account creati da un admin (SQL Editor / service_role / dashboard
--    Supabase) NON passano dal filtro: restano sempre possibili, anche con
--    domini diversi (es. l'admin di riserva su gmail).
--
-- 2. TEAM DI ATTERRAGGIO: finora il trigger assegnava "il primo team creato"
--    (retaggio della v1 a team unico) — che oggi è la Direzione Generale.
--    Con l'auto-registrazione ci finirebbero tutti, ereditando l'approvatore
--    sbagliato. I nuovi iscritti vanno invece in un team di parcheggio
--    "In attesa di assegnazione" (senza manager: nessuno approva finché non
--    li smisti dalla pagina Membri).
-- ============================================================================

-- Team di parcheggio per i nuovi iscritti. Senza manager_id e senza parent:
-- resta fuori dall'organigramma finché le persone non vengono assegnate.
insert into public.teams (name)
select 'In attesa di assegnazione'
where not exists (
  select 1 from public.teams where name = 'In attesa di assegnazione'
);

-- Domini di posta aziendali ammessi all'auto-registrazione.
create or replace function public.is_allowed_signup_domain(p_email text)
returns boolean
language sql immutable
as $$
  select lower(coalesce(p_email, '')) ~
         '@(tuaazienda\.com|secondobrand\.com|terzobrand\.com)$';
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_team uuid;
begin
  -- Filtro domini: si applica SOLO all'auto-registrazione. Le creazioni fatte
  -- da un amministratore (auth.uid() is null: SQL Editor, service_role,
  -- dashboard Supabase) restano libere.
  if auth.uid() is null and not public.is_allowed_signup_domain(new.email) then
    raise exception 'Registrazione consentita solo con un indirizzo email aziendale (@tuaazienda.com, @secondobrand.com, @terzobrand.com)';
  end if;

  -- I nuovi iscritti atterrano nel team di parcheggio, non nel primo team
  -- creato (che è la Direzione). Fallback: primo team, se il parcheggio
  -- fosse stato rinominato/eliminato.
  select id into v_team
    from public.teams where name = 'In attesa di assegnazione' limit 1;
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
