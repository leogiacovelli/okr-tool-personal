"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewSetAction } from "@/lib/actions/review";
import type { Objective } from "@/lib/types";

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600";

export default function ReviewPanel({
  setId,
  objectives,
}: {
  setId: string;
  objectives: Objective[];
}) {
  const [general, setGeneral] = useState("");
  const [perObjective, setPerObjective] = useState<Record<string, string>>({});
  const [showPerObjective, setShowPerObjective] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function decide(decision: "approve" | "request_changes") {
    setMsg(null);
    startTransition(async () => {
      const objComments = Object.entries(perObjective)
        .filter(([, body]) => body.trim())
        .map(([objective_id, body]) => ({ objective_id, body }));
      const res = await reviewSetAction(setId, decision, general, objComments);
      if (res.error) {
        setMsg(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-5 dark:border-blue-900 dark:bg-blue-950/30">
      <h3 className="mb-3 font-semibold">Review objectives</h3>

      <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        General comment (required if requesting changes)
      </label>
      <textarea
        className={`${input} min-h-20`}
        value={general}
        onChange={(e) => setGeneral(e.target.value)}
        placeholder="Overall feedback on the objective set"
      />

      <button
        type="button"
        onClick={() => setShowPerObjective((v) => !v)}
        className="mt-3 text-sm text-blue-700 hover:underline dark:text-blue-400"
      >
        {showPerObjective ? "Hide per-objective comments" : "+ Comment on individual objectives"}
      </button>

      {showPerObjective && (
        <div className="mt-3 space-y-3">
          {objectives.map((o, i) => (
            <div key={o.id}>
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Objective {i + 1}: {o.objective}
              </label>
              <input
                className={input}
                value={perObjective[o.id] ?? ""}
                onChange={(e) =>
                  setPerObjective((prev) => ({ ...prev, [o.id]: e.target.value }))
                }
                placeholder="Comment on this objective (optional)"
              />
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("approve")}
          className="rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("request_changes")}
          className="rounded-lg border border-amber-500 px-3.5 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-400 dark:hover:bg-amber-950"
        >
          Request changes
        </button>
        {msg && <p className="text-sm text-red-600 dark:text-red-400">{msg}</p>}
      </div>
    </div>
  );
}
