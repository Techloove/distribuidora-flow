import { getRequestHeader } from "@tanstack/react-start/server";

export type ServerRole = "admin" | "gestor" | "financeiro" | "comercial" | "representante" | "estoque" | "expedicao";

type AuthUser = { id: string; email?: string | null };

function config() {
  const url = process.env["EXT_SUPABASE_URL"];
  const anonKey = process.env["EXT_SUPABASE_ANON_KEY"];
  if (!url || !anonKey) throw new Error("Configuração do Supabase não disponível no servidor.");
  return { url: url.replace(/\/$/, ""), anonKey };
}

export async function requireServerAuth(
  accessToken: string | undefined,
  allowedRoles: readonly ServerRole[],
): Promise<AuthUser> {
  const token = String(accessToken ?? "").trim();
  if (!token) throw new Error("Sessão não informada. Entre novamente.");

  const { url, anonKey } = config();
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) throw new Error("Sessão inválida ou expirada. Entre novamente.");

  const user = (await userRes.json()) as AuthUser;
  if (!user.id) throw new Error("Usuário autenticado não identificado.");

  const roleRes = await fetch(
    `${url}/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(user.id)}`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } },
  );
  if (!roleRes.ok) throw new Error("Não foi possível validar as permissões do usuário.");

  const rows = (await roleRes.json()) as Array<{ role?: string }>;
  const roles = new Set(rows.map((r) => String(r.role ?? "")));
  if (!allowedRoles.some((role) => roles.has(role))) {
    throw new Error("Usuário sem permissão para esta operação.");
  }

  return user;
}

export function requestAccessToken(): string | undefined {
  const value = getRequestHeader("authorization");
  if (!value) return undefined;
  return value.replace(/^Bearer\s+/i, "").trim() || undefined;
}


export async function enforceRateLimit(
  accessToken: string | undefined,
  action: string,
  limit = 30,
  windowSeconds = 60,
): Promise<void> {
  const token = String(accessToken ?? "").trim();
  if (!token) throw new Error("Sessão não informada. Entre novamente.");
  const { url, anonKey } = config();
  const res = await fetch(`${url}/rest/v1/rpc/consumir_rate_limit`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      _acao: action,
      _limite: limit,
      _janela_segundos: windowSeconds,
    }),
  });
  if (!res.ok) throw new Error("Não foi possível validar o limite de requisições.");
  const allowed = (await res.json()) as boolean;
  if (!allowed) throw new Error("Limite de consultas atingido. Tente novamente em alguns instantes.");
}
