import { createClient } from "@supabase/supabase-js";

/** Validate with Auth, then query with the user's JWT so RLS stays in force. */
export async function authenticateRequest(authorization: string | undefined) {
  const token = authorization?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token)
    throw Object.assign(new Error("Entre na sua conta para continuar."), { statusCode: 401 });
  const url = process.env["EXT_SUPABASE_URL"];
  const key = process.env["EXT_SUPABASE_ANON_KEY"];
  if (!url || !key) throw new Error("Serviço de autenticação não configurado.");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) =>
        fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) }),
    },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user)
    throw Object.assign(new Error("Sessão inválida ou expirada."), { statusCode: 401 });
  const [profile, roles] = await Promise.all([
    client.from("profiles").select("ativo").eq("id", data.user.id).single(),
    client.from("user_roles").select("role").eq("user_id", data.user.id),
  ]);
  if (profile.error || roles.error || profile.data?.ativo !== true || !roles.data?.length) {
    throw Object.assign(new Error("Seu acesso está desativado ou aguarda liberação."), {
      statusCode: 403,
    });
  }
  return { client, userId: data.user.id, roles: roles.data.map((r: { role: string }) => r.role) };
}

export function requireRole(roles: string[], allowed: readonly string[]) {
  if (!roles.some((role) => allowed.includes(role))) {
    throw Object.assign(new Error("Seu perfil não permite esta operação."), { statusCode: 403 });
  }
}
