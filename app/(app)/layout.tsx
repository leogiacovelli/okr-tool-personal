import Link from "next/link";
import { getProfile } from "@/lib/auth";
import { signOutAction } from "@/lib/actions/auth";
import ThemeToggle from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  const isManager = profile.role === "manager";
  const isViewer = profile.role === "viewer";

  const link = "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex h-auto max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/" className="font-semibold">
              OKR <span className="font-normal text-zinc-400">Marketing</span>
            </Link>
            <nav className="flex flex-wrap items-center gap-4 text-sm">
              {!isViewer && (
                <>
                  <Link className={link} href="/dashboard">I miei OKR</Link>
                  <Link className={link} href="/history">Storico</Link>
                </>
              )}
              {(isManager || isViewer) && (
                <>
                  <Link className={link} href="/team">Team</Link>
                  <Link className={link} href="/team/compare">Confronto</Link>
                </>
              )}
              {isManager && (
                <>
                  <Link className={link} href="/admin/periods">Periodi</Link>
                  <Link className={link} href="/admin/members">Membri</Link>
                </>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/account" className={`text-sm ${link}`}>
              {profile.full_name || profile.email}
            </Link>
            {isManager && (
              <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white dark:bg-zinc-100 dark:text-zinc-900">
                Manager
              </span>
            )}
            {isViewer && (
              <span className="rounded border border-zinc-400 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
                Osservatore
              </span>
            )}
            <ThemeToggle />
            <form action={signOutAction}>
              <button className={`text-sm ${link}`}>Esci</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
