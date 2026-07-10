"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireManager } from "@/lib/auth";
import { periodInput, inviteInput, teamInput } from "@/lib/validation";
import type { Team } from "@/lib/types";

/** Crea un nuovo semestre (solo manager; RLS lo impone anche a DB). */
export async function createPeriodAction(formData: FormData) {
  const profile = await requireManager();

  const parsed = periodInput.safeParse({
    label: formData.get("label"),
    starts_on: formData.get("starts_on"),
    ends_on: formData.get("ends_on"),
  });
  if (!parsed.success) {
    redirect(`/admin/periods?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("periods").insert({
    team_id: profile.team_id,
    label: parsed.data.label,
    starts_on: parsed.data.starts_on,
    ends_on: parsed.data.ends_on,
  });

  if (error) {
    const msg = error.code === "23505" ? "Esiste già un periodo con questa etichetta" : error.message;
    redirect(`/admin/periods?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/", "layout");
  redirect("/admin/periods?ok=1");
}

/** Legge i campi team di un form (stringa vuota → null). */
function teamFields(formData: FormData) {
  const managerId = String(formData.get("manager_id") ?? "");
  const parentId = String(formData.get("parent_team_id") ?? "");
  return {
    name: formData.get("name"),
    manager_id: managerId || null,
    parent_team_id: parentId || null,
  };
}

/** Crea un team nell'organigramma (solo admin; RLS lo impone anche a DB). */
export async function createTeamAction(formData: FormData) {
  await requireManager();
  const parsed = teamInput.safeParse(teamFields(formData));
  if (!parsed.success) {
    redirect(`/admin/teams?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("teams").insert(parsed.data);
  if (error) {
    const msg = error.code === "23505" ? "Esiste già un team con questo nome" : error.message;
    redirect(`/admin/teams?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/", "layout");
  redirect("/admin/teams?ok=1");
}

/** Aggiorna manager e posizione di un team (con controllo anti-cicli). */
export async function updateTeamAction(formData: FormData) {
  await requireManager();
  const teamId = String(formData.get("team_id") ?? "");
  const parsed = teamInput.safeParse(teamFields(formData));
  if (!parsed.success) {
    redirect(`/admin/teams?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  }

  const supabase = await createClient();

  // Un team non può stare sotto sé stesso né sotto un proprio discendente.
  if (parsed.data.parent_team_id) {
    const { data: teamsData } = await supabase.from("teams").select("id, parent_team_id");
    const teams = (teamsData ?? []) as Pick<Team, "id" | "parent_team_id">[];
    let cursor: string | null = parsed.data.parent_team_id;
    for (let i = 0; cursor && i < 20; i++) {
      if (cursor === teamId) {
        redirect(
          `/admin/teams?error=${encodeURIComponent(
            "Struttura non valida: un team non può stare sotto sé stesso o un suo sotto-team"
          )}`
        );
      }
      cursor = teams.find((t) => t.id === cursor)?.parent_team_id ?? null;
    }
  }

  const { error } = await supabase.from("teams").update(parsed.data).eq("id", teamId);
  if (error) {
    const msg = error.code === "23505" ? "Esiste già un team con questo nome" : error.message;
    redirect(`/admin/teams?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/", "layout");
  redirect("/admin/teams?ok=1");
}

/** Sposta una persona in un altro team (cambia anche chi la approva). */
export async function movePersonAction(formData: FormData) {
  await requireManager();
  const profileId = String(formData.get("profile_id") ?? "");
  const teamId = String(formData.get("team_id") ?? "");
  if (!profileId || !teamId) {
    redirect(`/admin/members?error=${encodeURIComponent("Selezione non valida")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ team_id: teamId })
    .eq("id", profileId);
  if (error) {
    redirect(`/admin/members?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/", "layout");
  redirect("/admin/members?ok=team");
}

/**
 * Cambia il ruolo di un profilo (solo manager). Protezioni:
 * - non puoi cambiare il TUO ruolo (evita di chiuderti fuori per sbaglio);
 * - il DB rifiuta comunque di rimuovere l'ultimo manager (trigger).
 */
export async function updateRoleAction(formData: FormData) {
  const manager = await requireManager();

  const profileId = String(formData.get("profile_id") ?? "");
  const role = String(formData.get("role") ?? "");

  if (!["member", "viewer", "manager"].includes(role)) {
    redirect(`/admin/members?error=${encodeURIComponent("Ruolo non valido")}`);
  }
  if (profileId === manager.id) {
    redirect(
      `/admin/members?error=${encodeURIComponent(
        "Non puoi cambiare il tuo stesso ruolo: chiedi a un altro manager (o via SQL)"
      )}`
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", profileId);

  if (error) {
    redirect(`/admin/members?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/", "layout");
  redirect("/admin/members?ok=role");
}

/**
 * Invita un nuovo membro via email (Supabase Auth admin API).
 * Richiede SUPABASE_SERVICE_ROLE_KEY; il profilo viene creato dal trigger
 * on_auth_user_created con ruolo 'member'.
 */
export async function inviteMemberAction(formData: FormData) {
  await requireManager();

  const parsed = inviteInput.safeParse({
    email: formData.get("email"),
    full_name: formData.get("full_name"),
  });
  if (!parsed.success) {
    redirect(`/admin/members?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  }

  const admin = createAdminClient();
  if (!admin) {
    redirect(
      `/admin/members?error=${encodeURIComponent(
        "SUPABASE_SERVICE_ROLE_KEY non configurata: invita l'utente dal dashboard Supabase (Authentication → Users → Invite)"
      )}`
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { error } = await admin!.auth.admin.inviteUserByEmail(parsed.data.email, {
    data: { full_name: parsed.data.full_name },
    redirectTo: `${appUrl.replace(/\/$/, "")}/auth/callback?next=/account`,
  });

  if (error) {
    redirect(`/admin/members?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/", "layout");
  redirect("/admin/members?ok=1");
}
