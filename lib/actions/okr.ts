"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { objectivesPayload, proposalsPayload } from "@/lib/validation";
import { weightSum } from "@/lib/format";
import { notifySubmitted, notifyResultsProposed } from "@/lib/email";
import type { ActionResult } from "@/lib/types";

/**
 * MEMBER actions. Every action uses the Supabase client with the user's
 * session: RLS and state triggers always apply — the validation here
 * only serves to give clear error messages.
 */

/**
 * Context for notifications: the recipient of submit/proposal emails
 * is the owner's APPROVER, i.e. the manager of their team (org chart),
 * no longer a "global manager".
 */
async function setContext(setId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("okr_sets")
    .select(
      "id, profile_id, period_id, period:periods(label), owner:profiles(full_name, email, team_id)"
    )
    .eq("id", setId)
    .single();
  if (!data) return null;
  const row = data as unknown as {
    profile_id: string;
    period_id: string;
    period: { label: string } | null;
    owner: { full_name: string; email: string; team_id: string } | null;
  };

  let approverEmail: string | null = null;
  if (row.owner?.team_id) {
    const { data: team } = await supabase
      .from("teams")
      .select("manager_id")
      .eq("id", row.owner.team_id)
      .maybeSingle();
    const managerId = (team as { manager_id: string | null } | null)?.manager_id;
    if (managerId) {
      const { data: approver } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", managerId)
        .maybeSingle();
      approverEmail = (approver as { email: string } | null)?.email ?? null;
    }
  }

  return {
    memberId: row.profile_id,
    periodId: row.period_id,
    periodLabel: row.period?.label ?? "",
    memberName: row.owner?.full_name || row.owner?.email || "A team member",
    managerEmail: approverEmail,
  };
}

/** Creates the draft set for a semester ("Start draft" button). */
export async function createSetAction(formData: FormData) {
  const periodId = String(formData.get("period_id") ?? "");
  const profile = await getProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("okr_sets")
    .insert({ profile_id: profile.id, period_id: periodId });

  // Set already exists (unique constraint): fine, we just open it.
  if (error && error.code !== "23505") {
    redirect(`/dashboard?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/", "layout");
  redirect(`/okr/${periodId}`);
}

/** Saves the draft (overwrites the previous version, as per the process). */
export async function saveObjectivesAction(setId: string, items: unknown): Promise<ActionResult> {
  await getProfile();
  const parsed = objectivesPayload.safeParse(items);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_objectives", {
    p_set_id: setId,
    p_objectives: parsed.data,
  });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Sends the set to the manager (draft/changes_requested → submitted). */
export async function submitSetAction(setId: string): Promise<ActionResult> {
  await getProfile();
  const supabase = await createClient();

  // Pre-check for a clear message (the DB trigger enforces it regardless).
  const { data: objectives } = await supabase
    .from("objectives")
    .select("weight")
    .eq("set_id", setId);

  const total = weightSum((objectives ?? []).map((o) => Number(o.weight)));
  if (!objectives || objectives.length === 0) {
    return { error: "Add at least one objective before submitting" };
  }
  if (total !== 100) {
    return {
      error: `The sum of the weights must be 100% (current: ${new Intl.NumberFormat("en-US").format(total)}%)`,
    };
  }

  const { error } = await supabase
    .from("okr_sets")
    .update({ status: "submitted" })
    .eq("id", setId);
  if (error) return { error: error.message };

  const ctx = await setContext(setId);
  if (ctx?.managerEmail) {
    await notifySubmitted(ctx.managerEmail, ctx);
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/** The member proposes a Result + % (0–120) for each objective. */
export async function proposeResultsAction(setId: string, items: unknown): Promise<ActionResult> {
  await getProfile();
  const parsed = proposalsPayload.safeParse(items);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("propose_results", {
    p_set_id: setId,
    p_results: parsed.data,
  });
  if (error) return { error: error.message };

  const ctx = await setContext(setId);
  if (ctx?.managerEmail) {
    await notifyResultsProposed(ctx.managerEmail, ctx);
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
