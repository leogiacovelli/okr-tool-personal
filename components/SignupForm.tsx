"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ALLOWED_EMAIL_DOMAINS, isAllowedEmailDomain, passwordError } from "@/lib/validation";

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600";

/**
 * Self sign-up with a company email. The checks here give a clear
 * message right away: the check that actually matters is the
 * handle_new_user trigger on the database, which rejects disallowed
 * domains regardless of how the request arrives.
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
      setError("Enter your full name.");
      return;
    }
    if (!isAllowedEmailDomain(email)) {
      setError(
        `Use your company email address (${ALLOWED_EMAIL_DOMAINS.join(", ")}).`
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

    // With email confirmation enabled there's no session yet: it must be confirmed first.
    if (data.session) {
      window.location.assign("/");
      return;
    }
    setDone(data.user ? "confirm" : "in");
  }

  if (done) {
    return (
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-3 text-xl font-semibold">Account created</h1>
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          Check your company email and confirm your address to sign in.
        </p>
        <Link href="/login" className="mt-4 inline-block text-sm text-zinc-500 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
        OKR · Your Company
      </p>
      <h1 className="mb-1 mt-1 text-xl font-semibold">Create your account</h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        Sign up with your company email address.
      </p>

      <form onSubmit={signUp} className="space-y-3">
        <input
          className={input}
          required
          autoComplete="name"
          placeholder="Full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <input
          className={input}
          type="email"
          required
          autoComplete="email"
          placeholder="name.surname@yourcompany.com"
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
          At least 10 characters, with uppercase, lowercase, numbers and symbols.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {pending ? "Creating…" : "Create account"}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <p className="mt-6 text-xs text-zinc-400">
        Already have an account?{" "}
        <Link href="/login" className="underline hover:text-zinc-600 dark:hover:text-zinc-300">
          Sign in
        </Link>
      </p>
    </div>
  );
}
