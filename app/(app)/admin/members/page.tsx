import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { inviteMemberAction, updateRoleAction, movePersonAction } from "@/lib/actions/admin";
import { fmtDate } from "@/lib/format";
import type { Profile, Team } from "@/lib/types";

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600";
const label = "mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400";
const select =
  "rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const smallBtn =
  "rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

/**
 * Membri (solo admin): vista gerarchica per team — i team padre in alto,
 * i figli sotto e rientrati, come nell'organigramma. Da qui si spostano
 * le persone tra team e si assegnano i ruoli globali.
 */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const me = await requireManager();
  const { error, ok } = await searchParams;
  const supabase = await createClient();

  const [{ data }, { data: teamsData }] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name"),
    supabase.from("teams").select("*").order("created_at"),
  ]);
  const profiles = (data ?? []) as Profile[];
  const teams = (teamsData ?? []) as Team[];

  // Profondità nell'albero: i padri prima dei figli, con rientro.
  const depth = (t: Team): number => {
    let d = 0;
    let cur: Team | undefined = t;
    while (cur?.parent_team_id && d < 10) {
      cur = teams.find((x) => x.id === cur!.parent_team_id);
      d++;
    }
    return d;
  };

  const groups = teams
    .map((t) => ({ team: t, people: profiles.filter((p) => p.team_id === t.id) }))
    .filter((g) => g.people.length > 0)
    .sort((a, b) => depth(a.team) - depth(b.team));

  const personName = (id: string | null) => {
    if (!id) return "—";
    const p = profiles.find((x) => x.id === id);
    return p ? p.full_name || p.email : "—";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Membri</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Le persone, organizzate secondo l&rsquo;organigramma. La struttura dei team si modifica
          dalla pagina «Organigramma».
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          {ok === "role" ? "Ruolo aggiornato." : ok === "team" ? "Team aggiornato." : "Invito inviato."}
        </p>
      )}

      <form
        action={inviteMemberAction}
        className="grid gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-3"
      >
        <div>
          <label className={label}>Nome e cognome</label>
          <input className={input} name="full_name" required placeholder="es. Giulia Rossi" />
        </div>
        <div>
          <label className={label}>Email</label>
          <input className={input} name="email" type="email" required placeholder="email@azienda.it" />
        </div>
        <div className="flex items-end">
          <button className="w-full rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">
            Invita membro
          </button>
        </div>
      </form>

      {groups.map(({ team, people }) => (
        <section key={team.id} style={{ marginLeft: depth(team) * 24 }}>
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            {depth(team) > 0 && <span className="text-zinc-400">└</span>}
            <h2 className="font-semibold">{team.name}</h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              manager: {personName(team.manager_id)} · {people.length}{" "}
              {people.length === 1 ? "persona" : "persone"}
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full bg-white text-sm dark:bg-zinc-900">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Team</th>
                  <th className="px-4 py-3 font-medium">Ruolo</th>
                  <th className="px-4 py-3 font-medium">Creato</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                    <td className="px-4 py-3 font-medium">
                      {p.full_name || "—"}
                      {team.manager_id === p.id && (
                        <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          Manager del team
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{p.email}</td>
                    <td className="px-4 py-3">
                      <form action={movePersonAction} className="flex items-center gap-2">
                        <input type="hidden" name="profile_id" value={p.id} />
                        <select name="team_id" defaultValue={p.team_id} className={select}>
                          {teams.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                        <button className={smallBtn}>Salva</button>
                      </form>
                    </td>
                    <td className="px-4 py-3">
                      {p.id === me.id ? (
                        // Il proprio ruolo non si cambia da qui (protezione anti-lockout)
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white dark:bg-zinc-100 dark:text-zinc-900">
                          Admin (tu)
                        </span>
                      ) : (
                        <form action={updateRoleAction} className="flex items-center gap-2">
                          <input type="hidden" name="profile_id" value={p.id} />
                          <select name="role" defaultValue={p.role} className={select}>
                            <option value="member">Membro</option>
                            <option value="viewer">Osservatore</option>
                            <option value="manager">Admin</option>
                          </select>
                          <button className={smallBtn}>Salva</button>
                        </form>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{fmtDate(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
