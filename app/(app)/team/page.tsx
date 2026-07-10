import Link from "next/link";
import { requireTeamAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtPct, isCurrentPeriod } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import type { OkrSet, Period, Profile, Team } from "@/lib/types";

/**
 * Vista Team, raggruppata per team dell'organigramma.
 * Chi vede cosa lo decide la RLS: qui arrivano già solo i profili visibili
 * all'utente (il proprio sottoalbero per i manager, tutto per admin/viewer).
 * Sul team che l'utente GESTISCE può agire; sul resto è sola lettura.
 */
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { profile: me, managedTeamIds } = await requireTeamAccess();
  const { period: periodParam } = await searchParams;
  const supabase = await createClient();

  const [{ data: periodsData }, { data: peopleData }, { data: teamsData }] = await Promise.all([
    supabase.from("periods").select("*").order("starts_on", { ascending: false }),
    supabase.from("profiles").select("*").order("full_name"),
    supabase.from("teams").select("*").order("created_at"),
  ]);

  const periods = (periodsData ?? []) as Period[];
  const teams = (teamsData ?? []) as Team[];
  // Tutti i profili visibili (per risolvere i nomi dei manager, anche
  // osservatori); negli elenchi compaiono solo self esclusi e non-viewer.
  const allPeople = (peopleData ?? []) as Profile[];
  const people = allPeople.filter((p) => p.id !== me.id && p.role !== "viewer");
  const period =
    periods.find((p) => p.id === periodParam) ?? periods.find(isCurrentPeriod) ?? periods[0];

  const { data: setsData } = period
    ? await supabase.from("okr_sets").select("*").eq("period_id", period.id)
    : { data: [] };
  const sets = (setsData ?? []) as OkrSet[];
  const setFor = (memberId: string) => sets.find((s) => s.profile_id === memberId);

  // Ordina i team con i padri prima dei figli (profondità nell'albero).
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
    .map((t) => ({ team: t, members: people.filter((p) => p.team_id === t.id) }))
    .filter((g) => g.members.length > 0)
    .sort((a, b) => depth(a.team) - depth(b.team));

  const nameOf = (id: string | null) => {
    if (!id) return null;
    if (id === me.id) return me.full_name || me.email;
    const p = allPeople.find((x) => x.id === id);
    return p ? p.full_name || p.email : null;
  };

  // Da fare: solo sui team che gestisco io.
  const actionable = sets.filter((s) => {
    const owner = people.find((p) => p.id === s.profile_id);
    return owner && managedTeamIds.includes(owner.team_id);
  });
  const toReview = actionable.filter((s) => s.status === "submitted").length;
  const toEvaluate = actionable.filter((s) => s.status === "evaluation").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Le persone visibili a te, raggruppate per team. Puoi agire solo dove sei manager.
        </p>
      </div>

      {periods.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {periods.map((p) => (
            <Link
              key={p.id}
              href={`/team?period=${p.id}`}
              className={`rounded-full px-3 py-1 text-sm ${
                p.id === period?.id
                  ? "bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      )}

      {(toReview > 0 || toEvaluate > 0) && (
        <div className="flex flex-wrap gap-3 text-sm">
          {toReview > 0 && (
            <span className="rounded-lg bg-blue-100 px-3 py-1.5 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
              {toReview} review da fare
            </span>
          )}
          {toEvaluate > 0 && (
            <span className="rounded-lg bg-violet-100 px-3 py-1.5 text-violet-800 dark:bg-violet-950 dark:text-violet-300">
              {toEvaluate} in valutazione
            </span>
          )}
        </div>
      )}

      {groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Nessuna persona visibile. Gli account si gestiscono da «Membri», la struttura da
          «Organigramma».
        </p>
      )}

      {groups.map(({ team, members }) => (
        <section key={team.id}>
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <h2 className="font-semibold">{team.name}</h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              manager: {nameOf(team.manager_id) ?? "—"}
              {managedTeamIds.includes(team.id) && " (tu)"}
            </span>
            {!managedTeamIds.includes(team.id) && (
              <span className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                Sola lettura
              </span>
            )}
          </div>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full bg-white text-sm dark:bg-zinc-900">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-4 py-3 font-medium">Persona</th>
                  <th className="px-4 py-3 font-medium">Stato {period ? `· ${period.label}` : ""}</th>
                  <th className="px-4 py-3 font-medium">OKR Result</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const set = setFor(m.id);
                  return (
                    <tr
                      key={m.id}
                      className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium">{m.full_name || m.email}</p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">{m.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={set?.status ?? "none"} />
                      </td>
                      <td className="px-4 py-3 font-semibold">
                        {set?.status === "completed" ? fmtPct(set.final_score) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/team/${m.id}${period ? `?period=${period.id}` : ""}`}
                          className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                        >
                          Apri →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
