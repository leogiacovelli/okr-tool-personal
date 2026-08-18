"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startEvaluationAction } from "@/lib/actions/review";

export default function StartEvaluationButton({ setId }: { setId: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function start() {
    setMsg(null);
    startTransition(async () => {
      const res = await startEvaluationAction(setId);
      if (res.error) {
        setMsg(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={start}
        className="rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Start end-of-semester evaluation
      </button>
      {msg && <p className="text-sm text-red-600 dark:text-red-400">{msg}</p>}
    </div>
  );
}
