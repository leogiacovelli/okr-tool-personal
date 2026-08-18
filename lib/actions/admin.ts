"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireManager } from "@/lib/auth";
import { periodInput, inviteInput, teamInput } from "@/lib/validation";
import type { Team } from "@/lib/types";

/** Creates a new semester (manager only; also enforced by RLS at the DB level). */
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
    const msg = error.code === "23505" ? "A period with this label already exists" : error.message;
    redirect(`/admin/periods?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/", "layout");
  redirect("/admin/periods?ok=1");
}

/** Reads a form's team fields (empty string → null). */
function teamFields(formData: FormData) {
  const managerId = String(formData.get("manager_id") ?? "");
  const parentId = String(formData.get("parent_team_id") ?? "");
  return {
    name: formData.get("name"),
    manager_id: managerId || null,
    parent_team_id: parentId || null,
  };
}

/** Creates a team in the org chart (admin only; also enforced by RLS at the DB level). */
export async function createTeamAction(formData: FormData) {
  await requireManager();
  const parsed = teamInput.safeParse(teamFields(formData));
  if (!parsed.success) {
    redirect(`/admin/teams?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("teams").insert(parsed.data);
  if (error) {
    const msg = error.code === "23505" ? "A team with this name already exists" : error.message;
    redirect(`/admin/teams?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/", "layout");
  redirect("/admin/teams?ok=1");
}

/** Updates a team's manager and position (with anti-cycle check). */
export async function updateTeamAction(formData: FormData) {
  await requireManager();
  const teamId = String(formData.get("team_id") ?? "");
  const parsed = teamInput.safeParse(teamFields(formData));
  if (!parsed.success) {
    redirect(`/admin/teams?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  }

  const supabase = await createClient();

  // A team can't sit under itself or under one of its own descendants.
  if (parsed.data.parent_team_id) {
    const { data: teamsData } = await supabase.from("teams").select("id, parent_team_id");
    const teams = (teamsData ?? []) as Pick<Team, "id" | "parent_team_id">[];
    let cursor: string | null = parsed.data.parent_team_id;
    for (let i = 0; cursor && i < 20; i++) {
      if (cursor === teamId) {
        redirect(
          `/admin/teams?error=${encodeURIComponent(
            "Invalid structure: a team can't sit under itself or one of its own sub-teams"
          )}`
        );
      }
      cursor = teams.find((t) => t.id === cursor)?.parent_team_id ?? null;
    }
  }

  const { error } = await supabase.from("teams").update(parsed.data).eq("id", teamId);
  if (error) {
    const msg = error.code === "23505" ? "A team with this name already exists" : error.message;
    redirect(`/admin/teams?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/", "layout");
  redirect("/admin/teams?ok=1");
}

/** Moves a person to another team (also changes who approves them). */
export async function movePersonAction(formData: FormData) {
  await requireManager();
  const profileId = String(formData.get("profile_id") ?? "");
  const teamId = String(formData.get("team_id") ?? "");
  if (!profileId || !teamId) {
    redirect(`/admin/members?error=${encodeURIComponent("Invalid selection")}`);
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
 * Changes a profile's role (manager only). Protections:
 * - you can't change YOUR OWN role (avoids accidentally locking yourself out);
 * - the DB also rejects removing the last manager (trigger).
 */
export async function updateRoleAction(formData: FormData) {
  const manager = await requireManager();

  const profileId = String(formData.get("profile_id") ?? "");
  const role = String(formData.get("role") ?? "");

  if (!["member", "viewer", "manager"].includes(role)) {
    redirect(`/admin/members?error=${encodeURIComponent("Invalid role")}`);
  }
  if (profileId === manager.id) {
    redirect(
      `/admin/members?error=${encodeURIComponent(
        "You can't change your own role: ask another manager (or do it via SQL)"
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
 * Invites a new member by email (Supabase Auth admin API).
 * Requires SUPABASE_SERVICE_ROLE_KEY; the profile is created by the
 * on_auth_user_created trigger with role 'member'.
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
        "SUPABASE_SERVICE_ROLE_KEY not configured: invite the user from the Supabase dashboard (Authentication → Users → Invite)"
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
