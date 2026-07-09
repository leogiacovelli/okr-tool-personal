"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth";
import { finalScoresPayload } from "@/lib/validation";
import {
  notifyApproved,
  notifyChangesRequested,
  notifyCompleted,
  notifyEvaluationOpened,
} from "@/lib/email";
import type { ActionResult } from "@/lib/types";

/**
 * Azioni del MANAGER. Il ruolo è verificato qui (requireManager) E dal
 * database (trigger di transizione + RLS): un membro che chiamasse queste
 * azioni direttamente verrebbe comunque rifiutato dal DB.
 */

async function setContext(setId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("okr_sets")
    .select("id, profile_id, period_id, period:periods(label), owner:profiles(full_name, email)")
    .eq("id", setId)
    .single();
  if (!data) return null;
  const row = data as unknown as {
    profile_id: string;
    period_id: string;
    period: { label: string } | null;
    owner: { full_name: string; email: string } | null;
  };
  return {
    memberId: row.profile_id,
    periodId: row.period_id,
    periodLabel: row.period?.label ?? "",
    memberName: row.owner?.full_name || row.owner?.email || "Membro",
    memberEmail: row.owner?.email ?? null,
  };
}

/** Review: approva, oppure richiedi modifiche con feedback (generale e/o per obiettivo). */
export async function reviewSetAction(
  setId: string,
  decision: "approve" | "request_changes",
  generalComment: string,
  objectiveComments: { objective_id: string; body: string }[]
): Promise<ActionResult> {
  const manager = await requireManager();
  const supabase = await createClient();

  const comments = [
    ...(generalComment.trim()
      ? [{ set_id: setId, objective_id: null as string | null, author_id: manager.id, body: generalComment.trim() }]
      : []),
    ...objectiveComments
      .filter((c) => c.body.trim())
      .map((c) => ({
        set_id: setId,
        objective_id: c.objective_id as string | null,
        author_id: manager.id,
        body: c.body.trim(),
      })),
  ];

  if (decision === "request_changes" && comments.length === 0) {
    return { error: "Aggiungi un commento: il membro deve sapere cosa modificare" };
  }

  if (comments.length > 0) {
    const { error } = await supabase.from("review_comments").insert(comments);
    if (error) return { error: error.message };
  }

  const { error } = await supabase
    .from("okr_sets")
    .update({ status: decision === "approve" ? "approved" : "changes_requested" })
    .eq("id", setId);
  if (error) return { error: error.message };

  const ctx = await setContext(setId);
  if (ctx?.memberEmail) {
    if (decision === "approve") await notifyApproved(ctx.memberEmail, ctx);
    else await notifyChangesRequested(ctx.memberEmail, ctx);
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Apre la fase di valutazione di fine semestre (approved → evaluation). */
export async function startEvaluationAction(setId: string): Promise<ActionResult> {
  await requireManager();
  const supabase = await createClient();

  const { error } = await supabase
    .from("okr_sets")
    .update({ status: "evaluation" })
    .eq("id", setId);
  if (error) return { error: error.message };

  const ctx = await setContext(setId);
  if (ctx?.memberEmail) await notifyEvaluationOpened(ctx.memberEmail, ctx);

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Conferma la valutazione finale: salva Result e % confermata per ogni
 * obiettivo e chiude il semestre. L'OKR Result (media pesata) lo calcola
 * il trigger DB; qui lo riceviamo di ritorno per la notifica.
 */
export async function finalizeEvaluationAction(setId: string, items: unknown): Promise<ActionResult> {
  await requireManager();
  const parsed = finalScoresPayload.safeParse(items);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: score, error } = await supabase.rpc("finalize_evaluation", {
    p_set_id: setId,
    p_scores: parsed.data,
  });
  if (error) return { error: error.message };

  const ctx = await setContext(setId);
  if (ctx?.memberEmail && typeof score === "number") {
    await notifyCompleted(ctx.memberEmail, ctx, score);
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
