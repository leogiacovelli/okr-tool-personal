import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createSetAction } from "@/lib/actions/okr";
import { fmtDate, fmtPct, isCurrentPeriod } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import type { OkrSet, Period } from "@/lib/types";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const profile = await getProfile();
  // Viewers don't have their own OKRs: their home is the Team view.
  if (profile.role === "viewer") redirect("/team");
  const supabase = await createClient();

  const [{ data: periodsData }, { data: setsData }] = await Promise.all([
    supabase.from("periods").select("*").order("starts_on", { ascending: false }),
    supabase.from("okr_sets").select("*").eq("profile_id", profile.id),
  ]);

  const periods = (periodsData ?? []) as Period[];
  const sets = (setsData ?? []) as OkrSet[];
  const setFor = (p: Period) => sets.find((s) => s.period_id === p.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My OKRs</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Semi-annual objectives: define them, submit for review, then propose the results at the end of the semester.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {periods.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No semester has been configured yet: ask your manager to create the current period.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {periods.map((p) => {
          const set = setFor(p);
          const current = isCurrentPeriod(p);
          return (
            <div
              key={p.id}
              className={`rounded-xl border bg-white p-5 dark:bg-zinc-900 ${
                current
                  ? "border-zinc-400 dark:border-zinc-500"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">{p.label}</h2>
                  {current && (
                    <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white dark:bg-zinc-100 dark:text-zinc-900">
                      Current
                    </span>
                  )}
                </div>
                <StatusBadge status={set?.status ?? "none"} />
              </div>
              <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
                {fmtDate(p.starts_on)} → {fmtDate(p.ends_on)}
              </p>

              {set?.status === "completed" && (
                <p className="mb-4 text-sm">
                  OKR Result: <span className="text-lg font-bold">{fmtPct(set.final_score)}</span>
                </p>
              )}
              {set?.status === "changes_requested" && (
                <p className="mb-4 rounded-lg bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  Your manager requested changes: read the feedback and resubmit.
                </p>
              )}
              {set?.status === "evaluation" && (
                <p className="mb-4 rounded-lg bg-violet-50 p-2 text-sm text-violet-800 dark:bg-violet-950 dark:text-violet-300">
                  Evaluation phase open: propose the results you achieved.
                </p>
              )}

              {set ? (
                <Link
                  href={`/okr/${p.id}`}
                  className="inline-flex rounded-lg border border-zinc-300 px-3.5 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Open
                </Link>
              ) : (
                <form action={createSetAction}>
                  <input type="hidden" name="period_id" value={p.id} />
                  <button className="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">
                    Start draft
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
