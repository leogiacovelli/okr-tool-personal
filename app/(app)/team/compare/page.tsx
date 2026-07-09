import Link from "next/link";
import { requireTeamAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtPct, isCurrentPeriod } from "@/lib/format";
import type { OkrSet, Period } from "@/lib/types";

type SetWithOwner = OkrSet & { owner: { full_name: string; email: string } | null };

/** Vista aggregata: confronto OKR Result tra membri per semestre. */
export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requireTeamAccess();
  const { period: periodParam } = await searchParams;
  const supabase = await createClient();

  const { data: periodsData } = await supabase
    .from("periods")
    .select("*")
    .order("starts_on", { ascending: false });
  const periods = (periodsData ?? []) as Period[];
  const period =
    periods.find((p) => p.id === periodParam) ?? periods.find(isCurrentPeriod) ?? periods[0];

  const { data: setsData } = period
    ? await supabase
        .from("okr_sets")
        .select("*, owner:profiles(full_name, email)")
        .eq("period_id", period.id)
        .eq("status", "completed")
    : { data: [] };

  const sets = ((setsData ?? []) as unknown as SetWithOwner[]).sort(
    (a, b) => (b.final_score ?? 0) - (a.final_score ?? 0)
  );
  const avg =
    sets.length > 0
      ? sets.reduce((s, x) => s + (x.final_score ?? 0), 0) / sets.length
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Confronto team</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          OKR Result dei semestri chiusi, a confronto tra i membri.
        </p>
      </div>

      {periods.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {periods.map((p) => (
            <Link
              key={p.id}
              href={`/team/compare?period=${p.id}`}
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

      {sets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Nessun semestre chiuso per {period?.label ?? "questo periodo"}: il confronto appare dopo
          la conferma delle valutazioni finali.
        </p>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          {avg !== null && (
            <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
              Media team {period?.label}:{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {fmtPct(Math.round(avg * 100) / 100)}
              </span>
            </p>
          )}
          <div className="space-y-4">
            {sets.map((s) => {
              const score = s.final_score ?? 0;
              const width = Math.min((score / 120) * 100, 100);
              return (
                <div key={s.id}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <Link
                      href={`/team/${s.profile_id}?period=${s.period_id}`}
                      className="font-medium hover:underline"
                    >
                      {s.owner?.full_name || s.owner?.email || "Membro"}
                    </Link>
                    <span className="font-semibold">{fmtPct(s.final_score)}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className={`h-full rounded-full ${score >= 100 ? "bg-emerald-500" : score >= 70 ? "bg-blue-500" : "bg-amber-500"}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-zinc-400">Scala 0–120% (120% = massimo raggiungibile)</p>
        </div>
      )}
    </div>
  );
}
