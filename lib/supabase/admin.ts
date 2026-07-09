import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Client con service_role key: BYPASSA la RLS. Usato esclusivamente
 * lato server per invitare nuovi membri (auth admin API), mai esposto
 * al browser. Ritorna null se la chiave non è configurata.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
