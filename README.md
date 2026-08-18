# OKR Tool

Web app for managing semi-annual objectives (OKRs) across a company's teams: objective definition, manager review, end-of-semester evaluation and weighted scoring. Because the data is HR-sensitive, isolation is enforced at the **database** level (Row Level Security + Postgres triggers), not just in the UI.

## Stack

- **Next.js 15** (App Router) + TypeScript + Tailwind CSS 4
- **Supabase**: Postgres with RLS on every table, Supabase Auth (password + magic link)
- **Resend** for transactional emails (optional in dev)
- Deploy target: **Vercel**

## Process flow

```
Draft → Submitted for review → Approved → In evaluation → Closed
              ↓         ↑
          Changes requested
```

- The **member** defines the objectives (Objective, KR, SMART, Starting Point, Target, Weight) and submits them. The sum of the weights must be **100%** (blocking, also validated by the DB).
- The **manager** approves or requests changes with feedback (general and/or per-objective).
- At the end of the semester the manager opens the **evaluation**: the member proposes a Result and % (0–120%), the manager confirms or corrects it. On confirmation the DB computes the **OKR Result** (weighted average across the weights).
- Every transition is logged in an internal **audit log** (manager only).

The state machine is enforced by Postgres triggers: an illegal transition (or one made by the wrong role) is rejected by the database even if called directly via the API.

## Setup

### 1. Supabase project

1. Create a project on [supabase.com](https://supabase.com).
2. Run the migration [supabase/migrations/00001_init.sql](supabase/migrations/00001_init.sql):
   - **SQL Editor** in the dashboard: paste and run the file, or
   - CLI: `supabase link --project-ref <ref>` and `supabase db push`.

   The migration creates the schema, RLS, triggers, the "Marketing" team, and the "H2 2026" period.
3. In **Authentication → Providers** check that *Email* is enabled.
4. In **Authentication → URL Configuration** set:
   - *Site URL*: the app's URL (e.g. `https://okr.yourdomain.com`, in dev `http://localhost:3000`)
   - *Redirect URLs*: add `<site-url>/auth/callback`
5. **Recommended** (internal tool, HR data): in **Authentication → Sign In / Up** disable self sign-up (*Allow new users to sign up* → off). Accounts are created only via invite.

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill it in:

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | `anon` key (public, protected by RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | — | only used to invite members from `/admin/members`; **never** exposed to the client |
| `RESEND_API_KEY` | — | without a key, emails are just logged to the console |
| `EMAIL_FROM` | — | sender verified on Resend |
| `NEXT_PUBLIC_APP_URL` | ✅ | used in email links |

Keys live **only** in environment variables (`.env.local` is in `.gitignore`).

### 3. Start

```bash
npm install
npm run dev
```

### 4. First manager user

1. Create your user: Supabase dashboard → **Authentication → Users → Add user** (email + password), or invite yourself via *Invite user*. The profile is created automatically (role `member`).
2. Promote yourself to manager via the **SQL Editor**:

```sql
update public.profiles set role = 'manager', full_name = 'Your Name'
where email = 'your-email@company.com';
```

3. Log in at `/login`: you'll see the manager views (Team, Compare, Periods, Members).

### 5. Team members

- With `SUPABASE_SERVICE_ROLE_KEY` configured: invite them from **/admin/members** (they receive an invite email, the profile starts with role `member`).
- Alternatively: Supabase dashboard → Authentication → *Invite user*.
- Every user can set their name and password from **/account**.

### 6. Email (Resend)

1. Create an account on [resend.com](https://resend.com), verify the sender domain, and generate an API key.
2. Set `RESEND_API_KEY` and `EMAIL_FROM`.

Notifications sent: objectives submitted (→ manager), changes requested (→ member), objectives approved (→ member), evaluation opened (→ member), proposed results (→ manager), evaluation confirmed with score (→ member). Sending is best-effort: an email error never blocks the operation.

## Deploy to Vercel

1. Import the repo into Vercel (framework: Next.js, no extra config).
2. Add the production environment variables (incl. `NEXT_PUBLIC_APP_URL` = Vercel/custom domain URL).
3. Update *Site URL* and *Redirect URLs* on Supabase with the production URL.

HTTPS is enforced by Vercel; Supabase session cookies are `httpOnly`/`secure`; every page responds with `X-Robots-Tag: noindex, nofollow` (+ a `robots.txt` that disallows everything).

## Security model (in brief)

| Level | Mechanism |
|---|---|
| Row visibility | RLS: a member sees **only** their own objective sets/objectives/comments; the manager sees everything. Members can't see other members' profiles (only their own and the manager's). |
| State transitions | `okr_sets_transition` trigger: validates who can perform which transition, that the weights sum to 100 on submit, and computes the OKR Result on closing. |
| Fields per state | `objectives_guard` trigger: only definition fields can be touched while in definition; during evaluation the member can only touch the proposal, the manager only the confirmation. |
| Audit | `log_audit` trigger + function (SECURITY DEFINER): submissions/reviews/approvals/confirmations are tracked with author and timestamp; readable only by the manager. |
| Input | Zod validation on every server action + DB CHECK constraints (weight 0–100, scores 0–120). |
| Routes | Middleware: no route (except `/login` and `/auth/*`) without a valid session. |

## Project structure

```
supabase/migrations/00001_init.sql   Schema + RLS + triggers + RPC (commented)
middleware.ts                        Mandatory auth on every route
lib/supabase/                        Browser/server/middleware/admin clients
lib/actions/                         Server actions (okr, review, admin, auth)
lib/email.ts                         Resend notifications (English templates)
lib/validation.ts                    Shared Zod schemas
app/(app)/dashboard, okr/[periodId]  Member views (+ history, account)
app/(app)/team, team/[memberId],     Manager views (overview, detail/review,
  team/compare                         evaluation, aggregate comparison)
app/(app)/admin/periods, members     Semester and invite management
components/                          Objectives editor, evaluation form, badges, etc.
```

## v1 notes and limits

- Single team, single manager (the data model — `teams` table, roles on `profiles` — is already set up for multi-team extension without a redesign).
- No version history in the UI: re-submission overwrites; the internal audit log keeps the trail of who/what/when.
- The evaluation phase opens per member (button on the card) — bulk opening per period would be an easy extension.
- Excel import/export and Slack integrations are out of scope.
