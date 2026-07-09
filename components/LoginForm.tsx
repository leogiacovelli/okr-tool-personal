"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600";

const ERRORS: Record<string, string> = {
  auth: "Link di accesso non valido o scaduto. Riprova.",
  profile: "Profilo non trovato. Contatta il manager.",
};

export default function LoginForm({ initialError }: { initialError?: string }) {
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError ? (ERRORS[initialError] ?? initialError) : null
  );
  const [sent, setSent] = useState(false);

  async function signInPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError("Credenziali non valide.");
      setPending(false);
      return;
    }
    window.location.assign("/");
  }

  async function signInMagic(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: false, // gli account li crea il manager
      },
    });
    setPending(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
        OKR · Team Marketing
      </p>
      <h1 className="mb-6 mt-1 text-xl font-semibold">Accedi</h1>

      <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-800">
        {(["password", "magic"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
              setSent(false);
            }}
            className={`rounded-md py-1.5 font-medium transition ${
              mode === m
                ? "bg-white shadow-sm dark:bg-zinc-900"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {m === "password" ? "Password" : "Magic link"}
          </button>
        ))}
      </div>

      {mode === "password" ? (
        <form onSubmit={signInPassword} className="space-y-3">
          <input
            className={input}
            type="email"
            required
            autoComplete="email"
            placeholder="email@azienda.it"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className={input}
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {pending ? "Accesso…" : "Accedi"}
          </button>
        </form>
      ) : sent ? (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          Controlla la tua email: ti abbiamo inviato un link di accesso.
        </p>
      ) : (
        <form onSubmit={signInMagic} className="space-y-3">
          <input
            className={input}
            type="email"
            required
            autoComplete="email"
            placeholder="email@azienda.it"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {pending ? "Invio…" : "Inviami il link di accesso"}
          </button>
        </form>
      )}

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <p className="mt-6 text-xs text-zinc-400">
        Gli account vengono creati dal manager: non è prevista la registrazione autonoma.
      </p>
    </div>
  );
}
