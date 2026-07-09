import { fmtDateTime } from "@/lib/format";
import type { Objective, ReviewComment } from "@/lib/types";

export default function CommentsList({
  comments,
  objectives,
}: {
  comments: ReviewComment[];
  objectives: Objective[];
}) {
  if (comments.length === 0) return null;

  const titleFor = (objectiveId: string | null) => {
    if (!objectiveId) return null;
    const idx = objectives.findIndex((o) => o.id === objectiveId);
    return idx >= 0 ? `Obiettivo ${idx + 1}: ${objectives[idx].objective}` : "Obiettivo rimosso";
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-5 dark:border-amber-900 dark:bg-amber-950/30">
      <h3 className="mb-3 font-semibold">Feedback</h3>
      <ul className="space-y-3">
        {comments.map((c) => (
          <li key={c.id} className="text-sm">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {c.author?.full_name || "Manager"} · {fmtDateTime(c.created_at)}
              {titleFor(c.objective_id) && (
                <span className="ml-1 font-medium">— {titleFor(c.objective_id)}</span>
              )}
            </p>
            <p className="whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
