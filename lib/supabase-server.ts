/**
 * Server-only Supabase client using the service role key, which
 * bypasses Row Level Security entirely. NEVER import this from a
 * "use client" component or expose SUPABASE_SERVICE_ROLE_KEY with a
 * NEXT_PUBLIC_ prefix — it must only ever run in API routes / server
 * code.
 */
import { createClient } from "@supabase/supabase-js";

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
