import { fmtPct } from "@/lib/format";
import type { Objective } from "@/lib/types";

/**
 * Read-only view of a set's objectives.
 * showProposals: shows the Result/% proposed by the member (evaluation phase).
 * showFinals: shows the % confirmed by the manager (closed semester).
 */
export default function ObjectivesReadOnly({
  objectives,
  showProposals = false,
  showFinals = false,
}: {
  objectives: Objective[];
  showProposals?: boolean;
  showFinals?: boolean;
}) {
  if (objectives.length === 0) {
    return <p className="text-sm text-zinc-500">No objectives defined.</p>;
  }

  return (
    <div className="space-y-4">
      {objectives.map((o, i) => (
        <div
          key={o.id}
          className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-zinc-400">Objective {i + 1}</p>
              <h3 className="font-semibold">{o.objective}</h3>
            </div>
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              Weight {fmtPct(o.weight)}
            </span>
          </div>

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Key Result</dt>
              <dd>{o.key_result}</dd>
            </div>
            {o.metric_type && (
              <div>
                <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Unit / metric</dt>
                <dd>{o.metric_type}</dd>
              </div>
            )}
            {o.starting_point && (
              <div>
                <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Starting Point</dt>
                <dd>{o.starting_point}</dd>
              </div>
            )}
            {o.target_outcome && (
              <div>
                <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Target Outcome</dt>
                <dd>{o.target_outcome}</dd>
              </div>
            )}
            {o.smart_requirements && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  SMART / Completion requirements
                </dt>
                <dd className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                  {o.smart_requirements}
                </dd>
              </div>
            )}
          </dl>

          {(showProposals || showFinals) && (
            <div className="mt-4 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50">
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Result</p>
                  <p>{o.result_value ?? "—"}</p>
                </div>
                {showProposals && (
                  <div>
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Proposed %</p>
                    <p>{fmtPct(o.proposed_score)}</p>
                  </div>
                )}
                {showFinals && (
                  <div>
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Confirmed %</p>
                    <p className="font-semibold">{fmtPct(o.final_score)}</p>
                  </div>
                )}
                {o.result_note && (
                  <div className="sm:col-span-3">
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Note</p>
                    <p className="whitespace-pre-wrap">{o.result_note}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
