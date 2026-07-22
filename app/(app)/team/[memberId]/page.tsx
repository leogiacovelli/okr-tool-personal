import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeamAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtPct, fmtDateTime, isCurrentPeriod } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import ObjectivesReadOnly from "@/components/ObjectivesReadOnly";
import ReviewPanel from "@/components/ReviewPanel";
import FinalizeEvaluationForm from "@/components/FinalizeEvaluationForm";
import StartEvaluationButton from "@/components/StartEvaluationButton";
import ReopenButton from "@/components/ReopenButton";
import CommentsList from "@/components/CommentsList";
import type { Objective, OkrSet, Period, Profile, ReviewComment } from "@/lib/types";

/**
 * Vista MANAGER del singolo membro: obiettivi del semestre selezionato,
 * azioni di review (approva / richiedi modifiche), apertura e conferma
 * della valutazione finale, storico degli altri semestri.
 */
export default async function MemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { managedTeamIds } = await requireTeamAccess();
  const { memberId } = await params;
  const { period: periodParam } = await searchParams;
  const supabase = await createClient();

  const [{ data: memberData }, { data: periodsData }, { data: setsData }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", memberId).maybeSingle(),
    supabase.from("periods").select("*").order("starts_on", { ascending: false }),
    supabase.from("okr_sets").select("*").eq("profile_id", memberId),
  ]);

  if (!memberData) notFound();
  const member = memberData as Profile;
  // Posso AGIRE solo se sono il manager del team di questa persona
  // (organigramma); altrimenti la scheda è in sola lettura. Il database
  // applica comunque la stessa regola.
  const canAct = managedTeamIds.includes(member.team_id);
  const periods = (periodsData ?? []) as Period[];
  const sets = (setsData ?? []) as OkrSet[];

  const period =
    periods.find((p) => p.id === periodParam) ?? periods.find(isCurrentPeriod) ?? periods[0];
  const set = period ? (sets.find((s) => s.period_id === period.id) ?? null) : null;

  const [{ data: objectivesData }, { data: commentsData }] = set
    ? await Promise.all([
        supabase.from("objectives").select("*").eq("set_id", set.id).order("position"),
        supabase
          .from("review_comments")
          .select("*, author:profiles(full_name)")
          .eq("set_id", set.id)
          .order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];

  const objectives = (objectivesData ?? []) as Objective[];
  const comments = (commentsData ?? []) as unknown as ReviewComment[];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/team"
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← Team
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{member.full_name || member.email}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{member.email}</p>
          </div>
          {set && <StatusBadge status={set.status} />}
        </div>
      </div>

      {periods.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {periods.map((p) => {
            const hasSet = sets.some((s) => s.period_id === p.id);
            return (
              <Link
                key={p.id}
                href={`/team/${member.id}?period=${p.id}`}
                className={`rounded-full px-3 py-1 text-sm ${
                  p.id === period?.id
                    ? "bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {p.label}
                {!hasSet && " ·"}
              </Link>
            );
          })}
        </div>
      )}

      {!period && (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Nessun semestre configurato.
        </p>
      )}

      {period && !set && (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {member.full_name || member.email} non ha ancora iniziato gli obiettivi per {period.label}.
        </p>
      )}

      {set && (
        <>
          {set.status === "completed" && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                OKR Result · {period?.label} — confermato il {fmtDateTime(set.completed_at)}
              </p>
              <p className="text-3xl font-bold">{fmtPct(set.final_score)}</p>
            </div>
          )}

          {set.status === "draft" && (
            <p className="rounded-lg bg-zinc-100 p-3 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              Bozza in lavorazione: il membro non ha ancora inviato gli obiettivi.
            </p>
          )}

          {set.status === "changes_requested" && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              Modifiche richieste: in attesa che il membro aggiorni e reinvii gli obiettivi.
            </p>
          )}

          {set.status === "submitted" &&
            (canAct ? (
              <ReviewPanel setId={set.id} objectives={objectives} />
            ) : (
              <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                Obiettivi inviati: in attesa della review del manager.
              </p>
            ))}

          {set.status === "approved" &&
            (canAct ? (
              <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
                  Obiettivi approvati. A fine semestre, apri la fase di valutazione: il membro
                  riceverà una notifica per proporre i risultati.
                </p>
                <div className="flex flex-wrap items-start gap-3">
                  <StartEvaluationButton setId={set.id} />
                  <ReopenButton setId={set.id} />
                </div>
              </div>
            ) : (
              <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                Obiettivi approvati e confermati per il semestre.
              </p>
            ))}

          {set.status === "evaluation" &&
            (canAct ? (
              <FinalizeEvaluationForm
                setId={set.id}
                objectives={objectives}
                memberProposed={set.results_proposed_at !== null}
              />
            ) : (
              <p className="rounded-lg bg-violet-50 p-3 text-sm text-violet-800 dark:bg-violet-950 dark:text-violet-300">
                Valutazione di fine semestre in corso: il manager sta confermando i risultati.
              </p>
            ))}

          {comments.length > 0 && <CommentsList comments={comments} objectives={objectives} />}

          {(set.status !== "evaluation" || !canAct) && (
            <ObjectivesReadOnly
              objectives={objectives}
              showProposals={set.status === "completed" || set.status === "evaluation"}
              showFinals={set.status === "completed"}
            />
          )}
        </>
      )}

      {sets.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="mb-3 font-semibold">Storico semestri</h3>
          <ul className="space-y-2">
            {sets
              .slice()
              .sort((a, b) => {
                const pa = periods.find((p) => p.id === a.period_id)?.starts_on ?? "";
                const pb = periods.find((p) => p.id === b.period_id)?.starts_on ?? "";
                return pb.localeCompare(pa);
              })
              .map((s) => {
                const p = periods.find((x) => x.id === s.period_id);
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3">
                    <Link href={`/team/${member.id}?period=${s.period_id}`} className="hover:underline">
                      {p?.label ?? "—"}
                    </Link>
                    <span className="flex items-center gap-3">
                      {s.status === "completed" && (
                        <span className="font-semibold">{fmtPct(s.final_score)}</span>
                      )}
                      <StatusBadge status={s.status} />
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </div>
  );
}
