import { createClient } from "@supabase/supabase-js";

// This module is imported by Next.js route handlers only, never from client UI.
// A service-role key must NOT use a NEXT_PUBLIC_ environment variable.
export function payrollDb() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server-only Supabase credentials are unavailable");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
}
