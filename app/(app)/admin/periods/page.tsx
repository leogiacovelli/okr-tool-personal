import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createPeriodAction } from "@/lib/actions/admin";
import { fmtDate, isCurrentPeriod } from "@/lib/format";
import type { Period } from "@/lib/types";

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600";
const label = "mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400";

/** Gestione semestri (solo manager). */
export default async function PeriodsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  await requireManager();
  const { error, ok } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase.from("periods").select("*").order("starts_on", { ascending: false });
  const periods = (data ?? []) as Period[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Periodi</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          I semestri per cui il team definisce gli obiettivi (es. H1 2027, H2 2027).
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          Periodo creato.
        </p>
      )}

      <form
        action={createPeriodAction}
        className="grid gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-4"
      >
        <div>
          <label className={label}>Etichetta</label>
          <input className={input} name="label" required placeholder="es. H1 2027" />
        </div>
        <div>
          <label className={label}>Inizio</label>
          <input className={input} name="starts_on" type="date" required />
        </div>
        <div>
          <label className={label}>Fine</label>
          <input className={input} name="ends_on" type="date" required />
        </div>
        <div className="flex items-end">
          <button className="w-full rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">
            Crea periodo
          </button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full bg-white text-sm dark:bg-zinc-900">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="px-4 py-3 font-medium">Semestre</th>
              <th className="px-4 py-3 font-medium">Inizio</th>
              <th className="px-4 py-3 font-medium">Fine</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                <td className="px-4 py-3 font-medium">{p.label}</td>
                <td className="px-4 py-3">{fmtDate(p.starts_on)}</td>
                <td className="px-4 py-3">{fmtDate(p.ends_on)}</td>
                <td className="px-4 py-3">
                  {isCurrentPeriod(p) && (
                    <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white dark:bg-zinc-100 dark:text-zinc-900">
                      In corso
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
