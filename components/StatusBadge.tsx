import type { OkrStatus } from "@/lib/types";

const MAP: Record<OkrStatus | "none", { label: string; cls: string }> = {
  draft: {
    label: "Bozza",
    cls: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  submitted: {
    label: "In review",
    cls: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  },
  changes_requested: {
    label: "Modifiche richieste",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  approved: {
    label: "Approvato",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  evaluation: {
    label: "In valutazione",
    cls: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  },
  completed: {
    label: "Chiuso",
    cls: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  },
  none: {
    label: "Non iniziato",
    cls: "border border-dashed border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400",
  },
};

export default function StatusBadge({ status }: { status: OkrStatus | "none" }) {
  const { label, cls } = MAP[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}
