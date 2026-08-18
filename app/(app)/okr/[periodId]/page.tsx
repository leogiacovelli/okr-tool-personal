import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createSetAction } from "@/lib/actions/okr";
import { fmtPct, fmtDate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import ObjectivesEditor from "@/components/ObjectivesEditor";
import ObjectivesReadOnly from "@/components/ObjectivesReadOnly";
import ProposeResultsForm from "@/components/ProposeResultsForm";
import CommentsList from "@/components/CommentsList";
import type { Objective, OkrSet, Period, ReviewComment } from "@/lib/types";

/**
 * MEMBER view of their own OKR set for a semester.
 * The content changes based on the flow status:
 *   draft / changes_requested → editor
 *   submitted / approved      → read-only
 *   evaluation                → propose results
 *   completed                 → read-only with scores and OKR Result
 */
export default async function OkrPeriodPage({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  const { periodId } = await params;
  const profile = await getProfile();
  const supabase = await createClient();

  const { data: periodData } = await supabase
    .from("periods")
    .select("*")
    .eq("id", periodId)
    .maybeSingle();
  if (!periodData) notFound();
  const period = periodData as Period;

  const { data: setData } = await supabase
    .from("okr_sets")
    .select("*")
    .eq("period_id", periodId)
    .eq("profile_id", profile.id)
    .maybeSingle();
  const set = setData as OkrSet | null;

  const [{ data: objectivesData }, { data: commentsData }] = set
    ? await Promise.all([
        supabase.from("objectives").select("*").eq("set_id", set.id).order("position"),
        supabase
          .from("review_comments")
          .select("*, author:profiles(full_name)")
          .eq("set_id", set.id)
          .order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];

  const objectives = (objectivesData ?? []) as Objective[];
  const comments = (commentsData ?? []) as unknown as ReviewComment[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ← My OKRs
          </Link>
          <h1 className="text-2xl font-semibold">
            {period.label}
            <span className="ml-2 text-sm font-normal text-zinc-400">
              {fmtDate(period.starts_on)} → {fmtDate(period.ends_on)}
            </span>
          </h1>
        </div>
        <StatusBadge status={set?.status ?? "none"} />
      </div>

      {!set && (
        <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
          <p className="mb-4 text-sm text-zinc-500">
            You haven't started your objectives for this semester yet.
          </p>
          <form action={createSetAction} className="inline">
            <input type="hidden" name="period_id" value={period.id} />
            <button className="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">
              Start draft
            </button>
          </form>
        </div>
      )}

      {set && (
        <>
          {set.status === "completed" && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                OKR Result for the semester (weighted average of the confirmed %)
              </p>
              <p className="text-3xl font-bold">{fmtPct(set.final_score)}</p>
            </div>
          )}

          {(set.status === "changes_requested" || comments.length > 0) && (
            <CommentsList comments={comments} objectives={objectives} />
          )}

          {(set.status === "draft" || set.status === "changes_requested") && (
            <ObjectivesEditor setId={set.id} initial={objectives} />
          )}

          {set.status === "submitted" && (
            <>
              <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                Objectives sent to your manager: awaiting review. They can no longer be edited.
              </p>
              <ObjectivesReadOnly objectives={objectives} />
            </>
          )}

          {set.status === "approved" && (
            <>
              <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                Objectives approved and confirmed for the semester. At the end of the semester your
                manager will open the evaluation phase.
              </p>
              <ObjectivesReadOnly objectives={objectives} />
            </>
          )}

          {set.status === "evaluation" && (
            <ProposeResultsForm
              setId={set.id}
              objectives={objectives}
              alreadyProposedAt={set.results_proposed_at}
            />
          )}

          {set.status === "completed" && (
            <ObjectivesReadOnly objectives={objectives} showProposals showFinals />
          )}
        </>
      )}
    </div>
  );
}
