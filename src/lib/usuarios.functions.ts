import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Administracao de usuarios (Auth Admin API do Supabase externo).
 * O chamador precisa enviar o access token da sessao; o servidor valida o token
 * e confirma o papel `admin` em public.user_roles antes de qualquer operacao.
 */

type Env = { url: string; service: string };

function env(): Env {
  const url = process.env["EXT_SUPABASE_URL"] ?? "";
  const service = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"] ?? "";
  if (!url || !service) throw new Error("Supabase não configurado no servidor");
  return { url, service };
}

async function admin(path: string, init?: RequestInit) {
  const { url, service } = env();
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text) as { message?: string; msg?: string; error?: string };
      msg = j.message || j.msg || j.error || text;
    } catch {
      /* texto puro */
    }
    throw new Error(msg || `Erro ${res.status}`);
  }
  return text ? (JSON.parse(text) as unknown) : null;
}

/** Valida o token e exige papel admin. Devolve o id do chamador. */
async function exigirAdmin(token: string): Promise<string> {
  const { url, service } = env();
  const anon = process.env["EXT_SUPABASE_ANON_KEY"] ?? "";
  const me = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon || service, Authorization: `Bearer ${token}` },
  });
  if (!me.ok) {
    const body = await me.text();
    if (body.includes("Invalid API key")) {
      throw new Error(
        "Chave do Supabase inválida no servidor. Atualize o secret EXT_SUPABASE_SERVICE_ROLE_KEY com a service_role/secret key do projeto.",
      );
    }
    throw new Error("Sessão inválida. Entre novamente.");
  }
  const user = (await me.json()) as { id?: string };
  if (!user.id) throw new Error("Sessão inválida. Entre novamente.");
  const roles = (await admin(
    `/rest/v1/user_roles?select=role&user_id=eq.${user.id}&role=eq.admin`,
  )) as unknown[] | null;
  if (!roles || roles.length === 0) throw new Error("Apenas admin pode administrar usuários");
  return user.id;
}

export const criarUsuario = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        token: z.string().min(10),
        email: z.string().email(),
        senha: z.string().min(6),
        nome: z.string().trim().default(""),
        telefone: z.string().trim().default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await exigirAdmin(data.token);
    const created = (await admin("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: data.email,
        password: data.senha,
        email_confirm: true,
        user_metadata: { nome: data.nome },
      }),
    })) as { id?: string } | null;
    const id = created?.id;
    if (!id) throw new Error("Usuário não foi criado");

    await admin("/rest/v1/profiles", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        id,
        nome: data.nome || data.email,
        email: data.email,
        telefone: data.telefone || null,
      }),
    });

    return { id };
  });

export const atualizarUsuario = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        token: z.string().min(10),
        userId: z.string().uuid(),
        email: z.string().email().optional(),
        senha: z.string().min(6).optional().or(z.literal("")),
        nome: z.string().trim().optional(),
        telefone: z.string().trim().optional(),
        ativo: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await exigirAdmin(data.token);

    const authPatch: Record<string, unknown> = {};
    if (data.email) authPatch["email"] = data.email;
    if (data.senha) authPatch["password"] = data.senha;
    if (Object.keys(authPatch).length) {
      await admin(`/auth/v1/admin/users/${data.userId}`, {
        method: "PUT",
        body: JSON.stringify(authPatch),
      });
    }

    const patch: Record<string, unknown> = {};
    if (data.nome !== undefined) patch["nome"] = data.nome;
    if (data.email !== undefined) patch["email"] = data.email;
    if (data.telefone !== undefined) patch["telefone"] = data.telefone || null;
    if (data.ativo !== undefined) patch["ativo"] = data.ativo;
    if (Object.keys(patch).length) {
      await admin(`/rest/v1/profiles?id=eq.${data.userId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    }

    return { ok: true };
  });

export const excluirUsuario = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ token: z.string().min(10), userId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const meuId = await exigirAdmin(data.token);
    if (meuId === data.userId) throw new Error("Você não pode excluir o próprio usuário");
    await admin(`/auth/v1/admin/users/${data.userId}`, { method: "DELETE" });
    return { ok: true };
  });
