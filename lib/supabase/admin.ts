import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Client using the service_role key: BYPASSES RLS. Used exclusively
 * server-side to invite new members (auth admin API), never exposed
 * to the browser. Returns null if the key isn't configured.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
