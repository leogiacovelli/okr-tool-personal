"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { finalScoresPayload } from "@/lib/validation";
import {
  notifyApproved,
  notifyChangesRequested,
  notifyCompleted,
  notifyEvaluationOpened,
} from "@/lib/email";
import type { ActionResult } from "@/lib/types";

/**
 * REVIEWER actions (the manager of the owner's team, per the org chart).
 * Who has the right to act is decided by the DATABASE: RLS + triggers
 * check that the user is the manager of the right team — anyone else
 * gets an error, even calling the actions directly.
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
    memberName: row.owner?.full_name || row.owner?.email || "Member",
    memberEmail: row.owner?.email ?? null,
  };
}

/** Review: approve, or request changes with feedback (general and/or per-objective). */
export async function reviewSetAction(
  setId: string,
  decision: "approve" | "request_changes",
  generalComment: string,
  objectiveComments: { objective_id: string; body: string }[]
): Promise<ActionResult> {
  const manager = await getProfile();
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
    return { error: "Add a comment: the member needs to know what to change" };
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

/**
 * Reopens an already-approved set, moving it back to "Changes requested"
 * (approved → changes_requested). Used when objectives that were already
 * approved and presented need to be fixed later (remove one, rebalance
 * weights): the owner can edit them again and will need to resubmit for a
 * new approval. The right to act is still checked by the DB trigger.
 */
export async function reopenSetAction(setId: string, comment: string): Promise<ActionResult> {
  const manager = await getProfile();
  const supabase = await createClient();

  const body = comment.trim();
  if (body) {
    const { error } = await supabase
      .from("review_comments")
      .insert({ set_id: setId, objective_id: null, author_id: manager.id, body });
    if (error) return { error: error.message };
  }

  const { error } = await supabase
    .from("okr_sets")
    .update({ status: "changes_requested" })
    .eq("id", setId);
  if (error) return { error: error.message };

  const ctx = await setContext(setId);
  if (ctx?.memberEmail) await notifyChangesRequested(ctx.memberEmail, ctx);

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Opens the end-of-semester evaluation phase (approved → evaluation). */
export async function startEvaluationAction(setId: string): Promise<ActionResult> {
  await getProfile();
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
 * Confirms the final evaluation: saves the Result and confirmed % for
 * each objective and closes the semester. The OKR Result (weighted
 * average) is computed by the DB trigger; we receive it back here for
 * the notification.
 */
export async function finalizeEvaluationAction(setId: string, items: unknown): Promise<ActionResult> {
  await getProfile();
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
