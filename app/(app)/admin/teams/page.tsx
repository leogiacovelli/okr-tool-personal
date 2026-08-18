import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createTeamAction, updateTeamAction } from "@/lib/actions/admin";
import type { Profile, Team } from "@/lib/types";

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600";
const select =
  "rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const label = "mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400";

/**
 * Org chart (admin only): create teams, assign the manager, nest teams
 * under one another. This structure drives approvals and visibility:
 * · a person's OKRs are approved by their team's manager;
 * · a manager can read their entire subtree (read-only below the first
 *   level) and sees nothing of parallel branches.
 * People are moved between teams from the "Members" page.
 */
export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  await requireManager();
  const { error, ok } = await searchParams;
  const supabase = await createClient();

  const [{ data: teamsData }, { data: peopleData }] = await Promise.all([
    supabase.from("teams").select("*").order("created_at"),
    supabase.from("profiles").select("*").order("full_name"),
  ]);

  const teams = (teamsData ?? []) as Team[];
  const people = (peopleData ?? []) as Profile[];
  const memberCount = (teamId: string) => people.filter((p) => p.team_id === teamId).length;
  const personName = (id: string | null) =>
    id ? (people.find((p) => p.id === id)?.full_name ?? "—") : "—";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Org Chart</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          A person's OKRs are approved by their team's manager. A manager sees their own
          subtree; parallel branches can't see each other. People are moved between teams
          from the "Members" page.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          Org chart updated.
        </p>
      )}

      <form
        action={createTeamAction}
        className="grid gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-4"
      >
        <div>
          <label className={label}>New team name</label>
          <input className={input} name="name" required placeholder="e.g. Sales" />
        </div>
        <div>
          <label className={label}>Manager</label>
          <select className={`${select} w-full`} name="manager_id" defaultValue="">
            <option value="">— to be assigned —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Reports to</label>
          <select className={`${select} w-full`} name="parent_team_id" defaultValue="">
            <option value="">— none (top level) —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button className="w-full rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">
            Create team
          </button>
        </div>
      </form>

      <div className="space-y-4">
        {teams.map((t) => (
          <form
            key={t.id}
            action={updateTeamAction}
            className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <input type="hidden" name="team_id" value={t.id} />
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-semibold">{t.name}</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {memberCount(t.id)} people · current manager: {personName(t.manager_id)}
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className={label}>Name</label>
                  <input className={`${select} w-44`} name="name" defaultValue={t.name} required />
                </div>
                <div>
                  <label className={label}>Manager</label>
                  <select className={select} name="manager_id" defaultValue={t.manager_id ?? ""}>
                    <option value="">— none —</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || p.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label}>Reports to</label>
                  <select
                    className={select}
                    name="parent_team_id"
                    defaultValue={t.parent_team_id ?? ""}
                  >
                    <option value="">— none (top level) —</option>
                    {teams
                      .filter((x) => x.id !== t.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </select>
                </div>
                <button className="rounded-lg border border-zinc-300 px-3.5 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                  Save
                </button>
              </div>
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}
