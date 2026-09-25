import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseConfig } from "./supabase-config.functions";

let clientPromise: Promise<SupabaseClient> | null = null;

/** Cliente Supabase do browser (chave anon + sessão persistida, RLS aplicada). */
export function getSupabaseClient(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = getSupabaseConfig()
      .then((config) => {
        if (!config.url || !config.anonKey) {
          throw new Error("Serviço de acesso indisponível. Entre em contato com o administrador.");
        }
        return createClient(config.url, config.anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        });
      })
      .catch((error: unknown) => {
        clientPromise = null;
        throw error;
      });
  }
  return clientPromise;
}
