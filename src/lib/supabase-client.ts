import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseConfig } from "./supabase-config.functions";

let clientPromise: Promise<SupabaseClient> | null = null;

/** Cliente Supabase do browser (chave anon + sessão persistida, RLS aplicada). */
export function getSupabaseClient(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = getSupabaseConfig().then((config) => {
      if (!config.url || !config.anonKey) {
        throw new Error(
          "Configuração do Supabase ausente. Verifique os secrets EXT_SUPABASE_URL e EXT_SUPABASE_ANON_KEY.",
        );
      }
      return createClient(config.url, config.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    });
  }
  return clientPromise;
}
