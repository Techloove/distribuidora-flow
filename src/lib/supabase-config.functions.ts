import { createServerFn } from "@tanstack/react-start";

/**
 * Devolve a configuração pública do projeto Supabase externo.
 * A URL e a chave anon/publishable são valores públicos (o acesso real é
 * controlado por RLS), mas estão guardados como secrets do projeto, por isso
 * precisam ser lidos no servidor e entregues ao browser por aqui.
 */
export const getSupabaseConfig = createServerFn({ method: "GET" }).handler(async () => {
  return {
    url: process.env["EXT_SUPABASE_URL"] ?? "",
    anonKey: process.env["EXT_SUPABASE_ANON_KEY"] ?? "",
  };
});
