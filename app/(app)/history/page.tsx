import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtPct } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import type { OkrSet, Period } from "@/lib/types";

type SetWithPeriod = OkrSet & { period: Period | null };

/** History of the member's semesters (their own only, with the final OKR Result). */
export default async function HistoryPage() {
  const profile = await getProfile();
  if (profile.role === "viewer") redirect("/team");
  const supabase = await createClient();

  const { data } = await supabase
    .from("okr_sets")
    .select("*, period:periods(*)")
    .eq("profile_id", profile.id);

  const sets = ((data ?? []) as unknown as SetWithPeriod[]).sort((a, b) =>
    (b.period?.starts_on ?? "").localeCompare(a.period?.starts_on ?? "")
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Semester history</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Your past and current objective sets, with the final result.
        </p>
      </div>

      {sets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No semesters yet: start from the "My OKRs" page.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full bg-white text-sm dark:bg-zinc-900">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-4 py-3 font-medium">Semester</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">OKR Result</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => (
                <tr key={s.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                  <td className="px-4 py-3 font-medium">{s.period?.label ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    {s.status === "completed" ? fmtPct(s.final_score) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/okr/${s.period_id}`}
                      className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
