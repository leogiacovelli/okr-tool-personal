"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reopenSetAction } from "@/lib/actions/review";

/**
 * Moves an approved set back to "Changes requested" so the owner can
 * fix it (remove an objective, rebalance weights) and resubmit.
 * Asks for confirmation and a reason, which reaches the member as a comment.
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
        Reopen for changes
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
      <p className="text-sm text-amber-900 dark:text-amber-200">
        The set moves back to <strong>Changes requested</strong>: the member will be able to fix
        their objectives (remove some, rebalance weights) and will need to resubmit for a new
        approval.
      </p>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        placeholder="Reason (optional): what needs fixing"
        className="mt-3 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm dark:border-amber-800 dark:bg-zinc-900"
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={reopen}
          className="rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Confirm reopen
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
          Cancel
        </button>
        {msg && <p className="text-sm text-red-600 dark:text-red-400">{msg}</p>}
      </div>
    </div>
  );
}
