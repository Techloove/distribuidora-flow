import { clienteAnalitico } from "./modalidade-consultas";
import { useModalidade, setModalidade } from "./modalidade-store";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from "react";
import { getSupabaseClient } from "./supabase-client";
import { setCentro } from "./centro-store";
import { estadoRecuperacaoSenha } from "./auth-senhas";

export type AppRole =
  "admin" | "gestor" | "financeiro" | "comercial" | "representante" | "estoque" | "expedicao";
type SupabaseContextValue = {
  client: SupabaseClient | null;
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  needsCadastro: boolean;
  passwordRecovery: boolean;
  loading: boolean;
  error: string | null;
  canManage: boolean;
  signOut: () => Promise<void>;
};
const SupabaseContext = createContext<SupabaseContextValue | null>(null);

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let previousUser: string | null | undefined;
    let revision = 0;
    const accept = (next: Session | null) => {
      if (!active) return;
      const id = next?.user.id ?? null;
      if (previousUser !== id) {
        void queryClient.cancelQueries();
        queryClient.clear();
        setCentro("");
        setModalidade("todos");
        previousUser = id;
      }
      setSession(next);
      setInitializing(false);
    };
    void getSupabaseClient()
      .then(async (sb) => {
        if (!active) return;
        setClient(sb);
        const { data: listener } = sb.auth.onAuthStateChange((event, next) => {
          if (!active) return;
          setPasswordRecovery((anterior) => estadoRecuperacaoSenha(anterior, event));
          revision++;
          accept(next);
          if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
            void router.invalidate();
          }
        });
        unsubscribe = () => listener.subscription.unsubscribe();
        const requestedAt = revision;
        const { data, error } = await sb.auth.getSession();
        if (error) throw error;
        if (revision === requestedAt) accept(data.session);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setConnectionError(error instanceof Error ? error.message : "Falha ao conectar.");
        setInitializing(false);
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [queryClient, router]);

  const permissions = useQuery({
    queryKey: ["session-permissions", session?.user.id],
    enabled: !!client && !!session && !passwordRecovery,
    staleTime: 0,
    refetchInterval: 60_000,
    retry: 1,
    queryFn: async () => {
      const [profile, roles] = await Promise.all([
        client!.from("profiles").select("*").eq("id", session!.user.id).single(),
        client!.from("user_roles").select("role").eq("user_id", session!.user.id),
      ]);
      if (profile.error || roles.error)
        throw new Error("Não foi possível verificar seu acesso. Tente novamente.");
      if (profile.data?.cadastro_status === "pendente")
        throw new Error(
          "Seu cadastro de representante aguarda autorização do administrador. Se recebeu um e-mail de confirmação, confirme seu endereço.",
        );
      if (profile.data?.cadastro_status === "recusado")
        throw new Error("Seu cadastro não foi autorizado. Entre em contato com o administrador.");
      if (profile.data?.ativo !== true)
        throw new Error("Seu acesso está desativado. Procure o administrador.");
      return {
        roles: (roles.data ?? []).map((r: { role: AppRole }) => r.role),
        needsCadastro: profile.data?.precisa_completar_cadastro === true,
      };
    },
  });
  const roles = session && !permissions.isError ? (permissions.data?.roles ?? []) : [];
  const needsCadastro =
    !!session && !permissions.isError && permissions.data?.needsCadastro === true;
  const loading = initializing || (!!session && !passwordRecovery && permissions.isPending);
  const error =
    connectionError ?? (session && permissions.error ? permissions.error.message : null);
  useEffect(() => {
    if (!client || !session || loading || error) return;
    try {
      const encoded = session.access_token.split(".")[1];
      if (!encoded) return;
      const claims = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))) as {
        session_id?: string;
      };
      if (claims.session_id)
        void client.rpc("registrar_acesso_220", { _sessao: claims.session_id }).then(() => {});
    } catch {
      /* Sessões sem identificador não interrompem o acesso ao ERP. */
    }
  }, [client, session, loading, error]);
  async function signOut() {
    const result = await client?.auth.signOut();
    if (result?.error) throw new Error("Não foi possível encerrar a sessão. Tente novamente.");
    await queryClient.cancelQueries();
    queryClient.clear();
    setCentro("");
    setSession(null);
  }
  return (
    <SupabaseContext.Provider
      value={{
        client,
        session,
        user: session?.user ?? null,
        roles,
        needsCadastro,
        passwordRecovery,
        loading,
        error,
        canManage: !loading && !error && (roles.includes("admin") || roles.includes("gestor")),
        signOut,
      }}
    >
      {children}
    </SupabaseContext.Provider>
  );
}
export function useSupabase() {
  const context = useContext(SupabaseContext);
  if (!context) throw new Error("useSupabase precisa estar dentro de <SupabaseProvider>");
  return context;
}

/** Cliente de consulta: filtro de resultados sem alterar as operações do sistema. */
export function useSupabaseAnalitico() {
  const contexto = useSupabase(),
    { modalidade } = useModalidade();
  const client = useMemo(
    () => (contexto.client ? clienteAnalitico(contexto.client, modalidade) : null),
    [contexto.client, modalidade],
  );
  return { ...contexto, client };
}
