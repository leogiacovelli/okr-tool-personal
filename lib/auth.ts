import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/** Authenticated user's profile; redirects to /login if absent. */
export async function getProfile(): Promise<Profile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login?error=profile");

  return profile as Profile;
}

/**
 * Requires the ADMIN role (historical value 'manager' on profiles): manages
 * periods, accounts, roles, and the org chart. Does NOT grant approval
 * rights: those come from being the manager of a team (see requireTeamAccess).
 */
export async function requireManager(): Promise<Profile> {
  const profile = await getProfile();
  if (profile.role !== "manager") redirect("/dashboard");
  return profile;
}

/**
 * Access to team pages: admin, global viewer, or manager of at least one
 * team. Also returns the ids of the managed teams, which pages use to
 * decide where the user can ACT (the rest is read-only via RLS).
 */
export async function requireTeamAccess(): Promise<{
  profile: Profile;
  managedTeamIds: string[];
}> {
  const profile = await getProfile();
  const supabase = await createClient();
  const { data } = await supabase.from("teams").select("id").eq("manager_id", profile.id);
  const managedTeamIds = ((data ?? []) as { id: string }[]).map((t) => t.id);

  if (profile.role === "member" && managedTeamIds.length === 0) redirect("/dashboard");
  return { profile, managedTeamIds };
}
