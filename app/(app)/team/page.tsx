import Link from "next/link";
import { requireTeamViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtPct, isCurrentPeriod } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import type { OkrSet, Period, Profile } from "@/lib/types";

/** Dashboard manager: stato di ogni membro per il semestre selezionato. */
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requireTeamViewer();
  const { period: periodParam } = await searchParams;
  const supabase = await createClient();

  const [{ data: periodsData }, { data: membersData }] = await Promise.all([
    supabase.from("periods").select("*").order("starts_on", { ascending: false }),
    supabase.from("profiles").select("*").eq("role", "member").order("full_name"),
  ]);

  const periods = (periodsData ?? []) as Period[];
  const members = (membersData ?? []) as Profile[];
  const period =
    periods.find((p) => p.id === periodParam) ?? periods.find(isCurrentPeriod) ?? periods[0];

  const { data: setsData } = period
    ? await supabase.from("okr_sets").select("*").eq("period_id", period.id)
    : { data: [] };
  const sets = (setsData ?? []) as OkrSet[];
  const setFor = (memberId: string) => sets.find((s) => s.profile_id === memberId);

  const toReview = sets.filter((s) => s.status === "submitted").length;
  const toEvaluate = sets.filter((s) => s.status === "evaluation").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Stato degli obiettivi di ogni membro per il semestre selezionato.
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

      {members.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Nessun membro nel team: invitali dalla pagina «Membri».
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full bg-white text-sm dark:bg-zinc-900">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-4 py-3 font-medium">Membro</th>
                <th className="px-4 py-3 font-medium">Stato {period ? `· ${period.label}` : ""}</th>
                <th className="px-4 py-3 font-medium">OKR Result</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const set = setFor(m.id);
                return (
                  <tr key={m.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
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
      )}
    </div>
  );
}
