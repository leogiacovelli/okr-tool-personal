# OKR Tool — Team Marketing

Web app interna per la gestione degli obiettivi personali semestrali (OKR) del team Marketing. Un manager, fino a ~20 membri. Dati HR-sensitive: l'isolamento è garantito a livello di **database** (Row Level Security + trigger), non solo di UI.

## Stack

- **Next.js 15** (App Router) + TypeScript + Tailwind CSS 4
- **Supabase**: Postgres con RLS su ogni tabella, Supabase Auth (password + magic link)
- **Resend** per le email transazionali (opzionale in dev)
- Deploy target: **Vercel**

## Flusso di processo

```
Bozza → Inviato in review → Approvato → In valutazione → Chiuso
              ↓         ↑
        Modifiche richieste
```

- Il **membro** definisce gli obiettivi (Objective, KR, SMART, Starting Point, Target, Peso) e li invia. La somma dei pesi deve essere **100%** (bloccante, validata anche dal DB).
- Il **manager** approva o richiede modifiche con feedback (generale e/o per obiettivo).
- A fine semestre il manager apre la **valutazione**: il membro propone Result e % (0–120%), il manager conferma o corregge. Alla conferma il DB calcola l'**OKR Result** (media pesata sui pesi).
- Ogni transizione è registrata in un **audit log** interno (solo manager).

La state machine è applicata da trigger Postgres: una transizione illegale (o fatta dal ruolo sbagliato) viene rifiutata dal database anche se chiamata via API diretta.

## Setup

### 1. Progetto Supabase

1. Crea un progetto su [supabase.com](https://supabase.com).
2. Esegui la migrazione [supabase/migrations/00001_init.sql](supabase/migrations/00001_init.sql):
   - **SQL Editor** del dashboard: incolla ed esegui il file, oppure
   - CLI: `supabase link --project-ref <ref>` e `supabase db push`.

   La migrazione crea schema, RLS, trigger, il team "Marketing" e il periodo "H2 2026".
3. In **Authentication → Providers** verifica che *Email* sia abilitato.
4. In **Authentication → URL Configuration** imposta:
   - *Site URL*: l'URL dell'app (es. `https://okr.tuodominio.it`, in dev `http://localhost:3000`)
   - *Redirect URLs*: aggiungi `<site-url>/auth/callback`
5. **Consigliato** (tool interno, dati HR): in **Authentication → Sign In / Up** disabilita le registrazioni autonome (*Allow new users to sign up* → off). Gli account si creano solo tramite invito.

### 2. Variabili d'ambiente

Copia `.env.example` in `.env.local` e compila:

| Variabile | Obbligatoria | Note |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | chiave `anon` (pubblica, protetta da RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | — | solo per invitare membri da `/admin/members`; **mai** esposta al client |
| `RESEND_API_KEY` | — | senza chiave le email vengono loggate in console |
| `EMAIL_FROM` | — | mittente verificato su Resend |
| `NEXT_PUBLIC_APP_URL` | ✅ | usato nei link delle email |

Le chiavi vivono **solo** in variabili d'ambiente (`.env.local` è in `.gitignore`).

### 3. Avvio

```bash
npm install
npm run dev
```

### 4. Primo utente manager

1. Crea il tuo utente: dashboard Supabase → **Authentication → Users → Add user** (email + password), oppure invitati via *Invite user*. Il profilo viene creato automaticamente (ruolo `member`).
2. Promuoviti a manager dal **SQL Editor**:

```sql
update public.profiles set role = 'manager', full_name = 'Il Tuo Nome'
where email = 'tua-email@azienda.it';
```

3. Accedi su `/login`: vedrai le viste manager (Team, Confronto, Periodi, Membri).

### 5. Membri del team

- Con `SUPABASE_SERVICE_ROLE_KEY` configurata: invitali da **/admin/members** (ricevono email di invito, il profilo nasce col ruolo `member`).
- In alternativa: dashboard Supabase → Authentication → *Invite user*.
- Ogni utente può impostare nome e password da **/account**.

### 6. Email (Resend)

1. Crea un account su [resend.com](https://resend.com), verifica il dominio mittente e genera una API key.
2. Imposta `RESEND_API_KEY` e `EMAIL_FROM`.

Notifiche inviate: obiettivi inviati (→ manager), modifiche richieste (→ membro), obiettivi approvati (→ membro), valutazione aperta (→ membro), risultati proposti (→ manager), valutazione confermata con punteggio (→ membro). L'invio è best-effort: un errore email non blocca mai l'operazione.

## Deploy su Vercel

1. Importa il repo su Vercel (framework: Next.js, nessuna config extra).
2. Aggiungi le variabili d'ambiente di produzione (incl. `NEXT_PUBLIC_APP_URL` = URL Vercel/custom domain).
3. Aggiorna *Site URL* e *Redirect URLs* su Supabase con l'URL di produzione.

HTTPS è forzato da Vercel; i cookie di sessione Supabase sono `httpOnly`/`secure`; ogni pagina risponde con `X-Robots-Tag: noindex, nofollow` (+ `robots.txt` che nega tutto).

## Modello di sicurezza (in breve)

| Livello | Meccanismo |
|---|---|
| Visibilità righe | RLS: un membro vede **solo** i propri set/obiettivi/commenti; il manager tutto. I membri non vedono i profili degli altri membri (solo il proprio e quello del manager). |
| Transizioni di stato | Trigger `okr_sets_transition`: valida chi può fare quale transizione, la somma pesi = 100 al submit, e calcola l'OKR Result alla chiusura. |
| Campi per stato | Trigger `objectives_guard`: in definizione si toccano solo i campi di definizione; in valutazione il membro tocca solo proposta, il manager solo conferma. |
| Audit | Trigger + funzione `log_audit` (SECURITY DEFINER): submit/review/approvazioni/conferme tracciati con autore e timestamp; leggibile solo dal manager. |
| Input | Validazione Zod in ogni server action + vincoli CHECK a DB (peso 0–100, punteggi 0–120). |
| Route | Middleware: nessuna route (tranne `/login` e `/auth/*`) senza sessione valida. |

## Struttura del progetto

```
supabase/migrations/00001_init.sql   Schema + RLS + trigger + RPC (commentati)
middleware.ts                        Auth obbligatoria su ogni route
lib/supabase/                        Client browser/server/middleware/admin
lib/actions/                         Server actions (okr, review, admin, auth)
lib/email.ts                         Notifiche Resend (template in italiano)
lib/validation.ts                    Schemi Zod condivisi
app/(app)/dashboard, okr/[periodId]  Viste membro (+ history, account)
app/(app)/team, team/[memberId],     Viste manager (overview, dettaglio/review,
  team/compare                         valutazione, confronto aggregato)
app/(app)/admin/periods, members     Gestione semestri e inviti
components/                          Editor obiettivi, form valutazione, badge, ecc.
```

## Note e limiti della v1

- Un solo team e un solo manager (il data model — tabella `teams`, ruoli su `profiles` — è già pronto per estensioni multi-team senza redesign).
- Nessuno storico versioni in UI: la re-submission sovrascrive; l'audit log interno conserva la traccia di chi/cosa/quando.
- La fase di valutazione si apre per membro (bottone nella scheda) — apertura massiva per periodo è un'estensione facile.
- Import/export Excel e integrazioni Slack fuori scope.
