"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reopenSetAction } from "@/lib/actions/review";

/**
 * Riporta un set approvato in "Modifiche richieste" così che il proprietario
 * possa correggerlo (eliminare un obiettivo, ribilanciare i pesi) e reinviarlo.
 * Chiede conferma e una motivazione, che arriva al membro come commento.
 */
export default function ReopenButton({ setId }: { setId: string }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function reopen() {
    setMsg(null);
    startTransition(async () => {
      const res = await reopenSetAction(setId, comment);
      if (res.error) {
        setMsg(res.error);
        return;
      }
      setOpen(false);
      setComment("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-amber-300 px-3.5 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950"
      >
        Riapri per modifiche
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
      <p className="text-sm text-amber-900 dark:text-amber-200">
        Il set torna in <strong>Modifiche richieste</strong>: il membro potrà correggere
        gli obiettivi (eliminarne, ribilanciare i pesi) e dovrà reinviarlo per una nuova
        approvazione.
      </p>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        placeholder="Motivo (facoltativo): cosa va corretto"
        className="mt-3 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm dark:border-amber-800 dark:bg-zinc-900"
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={reopen}
          className="rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Conferma riapertura
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setMsg(null);
          }}
          className="text-sm text-zinc-600 hover:underline dark:text-zinc-300"
        >
          Annulla
        </button>
        {msg && <p className="text-sm text-red-600 dark:text-red-400">{msg}</p>}
      </div>
    </div>
  );
}
