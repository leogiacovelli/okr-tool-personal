"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveObjectivesAction, submitSetAction } from "@/lib/actions/okr";
import type { Objective } from "@/lib/types";

type Row = {
  objective: string;
  key_result: string;
  smart_requirements: string;
  starting_point: string;
  target_outcome: string;
  metric_type: string;
  weight: string;
};

const EMPTY: Row = {
  objective: "",
  key_result: "",
  smart_requirements: "",
  starting_point: "",
  target_outcome: "",
  metric_type: "",
  weight: "",
};

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600";
const label = "mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400";

export default function ObjectivesEditor({
  setId,
  initial,
}: {
  setId: string;
  initial: Objective[];
}) {
  const [rows, setRows] = useState<Row[]>(
    initial.length
      ? initial.map((o) => ({
          objective: o.objective,
          key_result: o.key_result,
          smart_requirements: o.smart_requirements,
          starting_point: o.starting_point,
          target_outcome: o.target_outcome,
          metric_type: o.metric_type,
          weight: String(o.weight),
        }))
      : [{ ...EMPTY }]
  );
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const total = rows.reduce((s, r) => s + Math.round((parseFloat(r.weight) || 0) * 100), 0) / 100;
  const totalOk = total === 100;

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function payload() {
    return rows.map((r) => ({ ...r, weight: parseFloat(r.weight) || 0 }));
  }

  function run(thenSubmit: boolean) {
    setMsg(null);
    startTransition(async () => {
      const saved = await saveObjectivesAction(setId, payload());
      if (saved.error) {
        setMsg({ kind: "err", text: saved.error });
        return;
      }
      if (thenSubmit) {
        const sub = await submitSetAction(setId);
        if (sub.error) {
          setMsg({ kind: "err", text: sub.error });
          return;
        }
        setMsg({ kind: "ok", text: "Objectives sent to your manager for review." });
      } else {
        setMsg({ kind: "ok", text: "Draft saved." });
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {rows.map((r, i) => (
        <div
          key={i}
          className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-semibold text-zinc-400">Objective {i + 1}</span>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-xs text-red-600 hover:underline dark:text-red-400"
              >
                Remove
              </button>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={label}>Objective (O)</label>
              <input
                className={input}
                value={r.objective}
                onChange={(e) => update(i, { objective: e.target.value })}
                placeholder="e.g. [Product Line] Growth - Quality target"
              />
            </div>
            <div>
              <label className={label}>Key Result (KR)</label>
              <input
                className={input}
                value={r.key_result}
                onChange={(e) => update(i, { key_result: e.target.value })}
                placeholder="e.g. Lead Scoring"
              />
            </div>
            <div>
              <label className={label}>Weight (%)</label>
              <input
                className={input}
                type="number"
                min={0.5}
                max={100}
                step={0.5}
                value={r.weight}
                onChange={(e) => update(i, { weight: e.target.value })}
                placeholder="e.g. 25"
              />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>SMART / Completion requirements</label>
              <textarea
                className={`${input} min-h-24`}
                value={r.smart_requirements}
                onChange={(e) => update(i, { smart_requirements: e.target.value })}
                placeholder="What it concretely means to complete this objective"
              />
            </div>
            <div>
              <label className={label}>Starting Point</label>
              <input
                className={input}
                value={r.starting_point}
                onChange={(e) => update(i, { starting_point: e.target.value })}
                placeholder="e.g. 0.00%"
              />
            </div>
            <div>
              <label className={label}>Target Outcome</label>
              <input
                className={input}
                value={r.target_outcome}
                onChange={(e) => update(i, { target_outcome: e.target.value })}
                placeholder="e.g. CPA < $140"
              />
            </div>
            <div>
              <label className={label}>Unit / metric type (optional)</label>
              <input
                className={input}
                value={r.metric_type}
                onChange={(e) => update(i, { metric_type: e.target.value })}
                placeholder="e.g. pts, $, %, text"
              />
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, { ...EMPTY }])}
        className="w-full rounded-xl border border-dashed border-zinc-300 py-3 text-sm text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:text-zinc-300"
      >
        + Add objective
      </button>

      <div className="sticky bottom-0 rounded-xl border border-zinc-200 bg-white/95 p-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            Weight total:{" "}
            <span className={`font-semibold ${totalOk ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
              {new Intl.NumberFormat("en-US").format(total)}%
            </span>
            {!totalOk && <span className="ml-2 text-xs text-zinc-500">must be 100% to submit</span>}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(false)}
              className="rounded-lg border border-zinc-300 px-3.5 py-2 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Save draft
            </button>
            <button
              type="button"
              disabled={pending || !totalOk}
              onClick={() => run(true)}
              className="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              Send to manager
            </button>
          </div>
        </div>
        {msg && (
          <p
            className={`mt-2 text-sm ${msg.kind === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
          >
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
