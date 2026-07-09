import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/** Profilo dell'utente autenticato; redirect a /login se assente. */
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
 * Richiede il ruolo ADMIN (valore storico 'manager' su profiles): amministra
 * periodi, account, ruoli e organigramma. NON dà diritti di approvazione:
 * quelli derivano dall'essere manager di un team (vedi requireTeamAccess).
 */
export async function requireManager(): Promise<Profile> {
  const profile = await getProfile();
  if (profile.role !== "manager") redirect("/dashboard");
  return profile;
}

/**
 * Accesso alle pagine di team: admin, osservatore globale, o manager di
 * almeno un team. Ritorna anche gli id dei team gestiti, da cui le pagine
 * derivano dove l'utente può AGIRE (il resto è sola lettura via RLS).
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
