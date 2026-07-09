"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600";
const label = "mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400";

export default function AccountForm({
  userId,
  initialName,
}: {
  userId: string;
  initialName: string;
}) {
  const [name, setName] = useState(initialName);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setPending(true);
    const supabase = createClient();

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ full_name: name.trim() })
      .eq("id", userId);
    if (profileError) {
      setMsg({ kind: "err", text: profileError.message });
      setPending(false);
      return;
    }

    if (password) {
      if (password.length < 8) {
        setMsg({ kind: "err", text: "La password deve avere almeno 8 caratteri." });
        setPending(false);
        return;
      }
      const { error: pwError } = await supabase.auth.updateUser({ password });
      if (pwError) {
        setMsg({ kind: "err", text: pwError.message });
        setPending(false);
        return;
      }
    }

    setPassword("");
    setMsg({ kind: "ok", text: "Profilo aggiornato." });
    setPending(false);
  }

  return (
    <form
      onSubmit={save}
      className="max-w-md space-y-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div>
        <label className={label}>Nome e cognome</label>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <label className={label}>Nuova password (lascia vuoto per non cambiarla)</label>
        <input
          className={input}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Minimo 8 caratteri"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          Salva
        </button>
        {msg && (
          <p
            className={`text-sm ${msg.kind === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
          >
            {msg.text}
          </p>
        )}
      </div>
    </form>
  );
}
