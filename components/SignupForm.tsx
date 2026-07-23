"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ALLOWED_EMAIL_DOMAINS, isAllowedEmailDomain, passwordError } from "@/lib/validation";

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600";

/**
 * Registrazione autonoma con email aziendale. I controlli qui servono a dare
 * un messaggio chiaro subito: il filtro che conta è il trigger handle_new_user
 * sul database, che rifiuta i domini non ammessi comunque si arrivi.
 */
export default function SignupForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"in" | "confirm" | null>(null);

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!fullName.trim()) {
      setError("Inserisci nome e cognome.");
      return;
    }
    if (!isAllowedEmailDomain(email)) {
      setError(
        `Usa il tuo indirizzo di posta aziendale (${ALLOWED_EMAIL_DOMAINS.join(", ")}).`
      );
      return;
    }
    const pwProblem = passwordError(password);
    if (pwProblem) {
      setError(pwProblem);
      return;
    }

    setPending(true);
    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setPending(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    // Con la conferma email attiva la sessione non c'è: va confermato prima.
    if (data.session) {
      window.location.assign("/");
      return;
    }
    setDone(data.user ? "confirm" : "in");
  }

  if (done) {
    return (
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-3 text-xl font-semibold">Account creato</h1>
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          Controlla la tua email aziendale e conferma l&apos;indirizzo per accedere.
        </p>
        <Link href="/login" className="mt-4 inline-block text-sm text-zinc-500 hover:underline">
          Torna all&apos;accesso
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
        OKR · La Tua Azienda
      </p>
      <h1 className="mb-1 mt-1 text-xl font-semibold">Crea il tuo account</h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        Registrati con il tuo indirizzo di posta aziendale.
      </p>

      <form onSubmit={signUp} className="space-y-3">
        <input
          className={input}
          required
          autoComplete="name"
          placeholder="Nome e cognome"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <input
          className={input}
          type="email"
          required
          autoComplete="email"
          placeholder="nome.cognome@tuaazienda.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className={input}
          type="password"
          required
          autoComplete="new-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-zinc-400">
          Almeno 10 caratteri, con maiuscole, minuscole, numeri e simboli.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {pending ? "Creazione…" : "Crea account"}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <p className="mt-6 text-xs text-zinc-400">
        Hai già un account?{" "}
        <Link href="/login" className="underline hover:text-zinc-600 dark:hover:text-zinc-300">
          Accedi
        </Link>
      </p>
    </div>
  );
}
