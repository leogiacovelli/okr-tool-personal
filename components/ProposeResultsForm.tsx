"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { proposeResultsAction } from "@/lib/actions/okr";
import type { Objective } from "@/lib/types";

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600";
const label = "mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400";

type Row = { result_value: string; result_note: string; proposed_score: string };

export default function ProposeResultsForm({
  setId,
  objectives,
  alreadyProposedAt,
}: {
  setId: string;
  objectives: Objective[];
  alreadyProposedAt: string | null;
}) {
  const [rows, setRows] = useState<Record<string, Row>>(
    Object.fromEntries(
      objectives.map((o) => [
        o.id,
        {
          result_value: o.result_value ?? "",
          result_note: o.result_note ?? "",
          proposed_score: o.proposed_score !== null ? String(o.proposed_score) : "",
        },
      ])
    )
  );
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function update(id: string, patch: Partial<Row>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function send() {
    setMsg(null);
    startTransition(async () => {
      const items = objectives.map((o) => ({
        id: o.id,
        result_value: rows[o.id].result_value,
        result_note: rows[o.id].result_note,
        proposed_score: rows[o.id].proposed_score,
      }));
      const res = await proposeResultsAction(setId, items);
      if (res.error) {
        setMsg({ kind: "err", text: res.error });
        return;
      }
      setMsg({ kind: "ok", text: "Proposal sent to your manager." });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {alreadyProposedAt && (
        <p className="rounded-lg bg-violet-50 p-3 text-sm text-violet-800 dark:bg-violet-950 dark:text-violet-300">
          You've already submitted a proposal. You can update it until your manager confirms the
          final evaluation.
        </p>
      )}

      {objectives.map((o, i) => (
        <div
          key={o.id}
          className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="mb-3">
            <p className="text-xs font-semibold text-zinc-400">Objective {i + 1} · weight {o.weight}%</p>
            <h3 className="font-semibold">{o.objective}</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              KR: {o.key_result}
              {o.target_outcome && <> · Target: {o.target_outcome}</>}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className={label}>Result achieved</label>
              <input
                className={input}
                value={rows[o.id].result_value}
                onChange={(e) => update(o.id, { result_value: e.target.value })}
                placeholder="e.g. CPA $132 / Lead scoring 58 pts"
              />
            </div>
            <div>
              <label className={label}>% achieved (0–120)</label>
              <input
                className={input}
                type="number"
                min={0}
                max={120}
                step={0.5}
                value={rows[o.id].proposed_score}
                onChange={(e) => update(o.id, { proposed_score: e.target.value })}
                placeholder="e.g. 100"
              />
            </div>
            <div className="sm:col-span-3">
              <label className={label}>Context note (optional)</label>
              <textarea
                className={`${input} min-h-16`}
                value={rows[o.id].result_note}
                onChange={(e) => update(o.id, { result_note: e.target.value })}
                placeholder="Context useful for the evaluation"
              />
            </div>
          </div>
        </div>
      ))}

      <div className="flex items-center justify-end gap-3">
        {msg && (
          <p
            className={`text-sm ${msg.kind === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
          >
            {msg.text}
          </p>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={send}
          className="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {alreadyProposedAt ? "Update proposal" : "Submit results proposal"}
        </button>
      </div>
    </div>
  );
}
