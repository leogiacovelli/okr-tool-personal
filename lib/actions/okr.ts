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
 * Azioni del MEMBRO. Ogni azione usa il client Supabase con la sessione
 * dell'utente: RLS e trigger di stato si applicano sempre — la validazione
 * qui serve solo a dare messaggi di errore chiari.
 */

/** Contesto (nome membro, periodo) per le notifiche email al manager. */
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
  const { data: manager } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("role", "manager")
    .limit(1)
    .maybeSingle();
  return {
    memberId: row.profile_id,
    periodId: row.period_id,
    periodLabel: row.period?.label ?? "",
    memberName: row.owner?.full_name || row.owner?.email || "Un membro del team",
    managerEmail: (manager as { email: string } | null)?.email ?? null,
  };
}

/** Crea la bozza del set per un semestre (bottone "Inizia bozza"). */
export async function createSetAction(formData: FormData) {
  const periodId = String(formData.get("period_id") ?? "");
  const profile = await getProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("okr_sets")
    .insert({ profile_id: profile.id, period_id: periodId });

  // Set già esistente (vincolo unique): va bene, si apre quello.
  if (error && error.code !== "23505") {
    redirect(`/dashboard?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/", "layout");
  redirect(`/okr/${periodId}`);
}

/** Salva la bozza (sovrascrive la versione precedente, come da processo). */
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

/** Invia il set al manager (draft/changes_requested → submitted). */
export async function submitSetAction(setId: string): Promise<ActionResult> {
  await getProfile();
  const supabase = await createClient();

  // Pre-check per un messaggio chiaro (il trigger DB lo garantisce comunque).
  const { data: objectives } = await supabase
    .from("objectives")
    .select("weight")
    .eq("set_id", setId);

  const total = weightSum((objectives ?? []).map((o) => Number(o.weight)));
  if (!objectives || objectives.length === 0) {
    return { error: "Aggiungi almeno un obiettivo prima di inviare" };
  }
  if (total !== 100) {
    return {
      error: `La somma dei pesi deve essere il 100% (attuale: ${new Intl.NumberFormat("it-IT").format(total)}%)`,
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

/** Il membro propone Result + % (0–120) per ogni obiettivo. */
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
