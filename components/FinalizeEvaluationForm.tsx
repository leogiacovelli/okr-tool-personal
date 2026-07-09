"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finalizeEvaluationAction } from "@/lib/actions/review";
import { fmtPct } from "@/lib/format";
import type { Objective } from "@/lib/types";

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600";
const label = "mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400";

type Row = { result_value: string; result_note: string; final_score: string };

export default function FinalizeEvaluationForm({
  setId,
  objectives,
  memberProposed,
}: {
  setId: string;
  objectives: Objective[];
  memberProposed: boolean;
}) {
  const [rows, setRows] = useState<Record<string, Row>>(
    Object.fromEntries(
      objectives.map((o) => [
        o.id,
        {
          result_value: o.result_value ?? "",
          result_note: o.result_note ?? "",
          final_score:
            o.final_score !== null
              ? String(o.final_score)
              : o.proposed_score !== null
                ? String(o.proposed_score)
                : "",
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

  // Anteprima OKR Result: media pesata delle % inserite.
  const allFilled = objectives.every((o) => rows[o.id].final_score !== "");
  const preview = allFilled
    ? objectives.reduce((s, o) => s + o.weight * (parseFloat(rows[o.id].final_score) || 0), 0) /
      objectives.reduce((s, o) => s + o.weight, 0)
    : null;

  function confirm() {
    setMsg(null);
    startTransition(async () => {
      const items = objectives.map((o) => ({
        id: o.id,
        result_value: rows[o.id].result_value,
        result_note: rows[o.id].result_note,
        final_score: rows[o.id].final_score,
      }));
      const res = await finalizeEvaluationAction(setId, items);
      if (res.error) {
        setMsg({ kind: "err", text: res.error });
        return;
      }
      setMsg({ kind: "ok", text: "Valutazione confermata: semestre chiuso." });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {!memberProposed && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Il membro non ha ancora proposto i risultati. Puoi comunque inserirli e confermare tu.
        </p>
      )}

      {objectives.map((o, i) => (
        <div
          key={o.id}
          className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="mb-3">
            <p className="text-xs font-semibold text-zinc-400">
              Obiettivo {i + 1} · peso {o.weight}%
            </p>
            <h3 className="font-semibold">{o.objective}</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              KR: {o.key_result}
              {o.target_outcome && <> · Target: {o.target_outcome}</>}
            </p>
            <p className="mt-1 text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Proposta del membro:</span>{" "}
              {o.result_value ?? "—"} · <strong>{fmtPct(o.proposed_score)}</strong>
              {o.result_note && (
                <span className="block text-zinc-500 dark:text-zinc-400">Nota: {o.result_note}</span>
              )}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className={label}>Result confermato</label>
              <input
                className={input}
                value={rows[o.id].result_value}
                onChange={(e) => update(o.id, { result_value: e.target.value })}
              />
            </div>
            <div>
              <label className={label}>% confermata (0–120)</label>
              <input
                className={input}
                type="number"
                min={0}
                max={120}
                step={0.5}
                value={rows[o.id].final_score}
                onChange={(e) => update(o.id, { final_score: e.target.value })}
              />
            </div>
            <div className="sm:col-span-3">
              <label className={label}>Nota (opzionale)</label>
              <input
                className={input}
                value={rows[o.id].result_note}
                onChange={(e) => update(o.id, { result_note: e.target.value })}
              />
            </div>
          </div>
        </div>
      ))}

      <div className="sticky bottom-0 rounded-xl border border-zinc-200 bg-white/95 p-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            Anteprima OKR Result:{" "}
            <span className="font-semibold">
              {preview !== null ? fmtPct(Math.round(preview * 100) / 100) : "—"}
            </span>
            <span className="ml-2 text-xs text-zinc-500">media pesata delle % confermate</span>
          </p>
          <button
            type="button"
            disabled={pending || !allFilled}
            onClick={confirm}
            className="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Conferma valutazione finale
          </button>
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
