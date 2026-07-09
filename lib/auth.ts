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

/** Come getProfile, ma richiede il ruolo manager (azioni e pagine admin). */
export async function requireManager(): Promise<Profile> {
  const profile = await getProfile();
  if (profile.role !== "manager") redirect("/dashboard");
  return profile;
}

/**
 * Manager o osservatore (viewer): per le viste di team in lettura.
 * Le azioni restano riservate al manager (requireManager + trigger DB).
 */
export async function requireTeamViewer(): Promise<Profile> {
  const profile = await getProfile();
  if (profile.role !== "manager" && profile.role !== "viewer") redirect("/dashboard");
  return profile;
}
