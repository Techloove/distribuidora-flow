import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getSupabaseClient } from "./supabase-client";
import { setCentro } from "./centro-store";

export type AppRole =
  "admin" | "gestor" | "financeiro" | "comercial" | "representante" | "estoque" | "expedicao";
type SupabaseContextValue = {
  client: SupabaseClient | null;
  session: Session | null;
  user: User | null;
  roles: AppRole[];
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
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const queryClient = useQueryClient();
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
        previousUser = id;
      }
      setSession(next);
      setInitializing(false);
    };
    void getSupabaseClient()
      .then(async (sb) => {
        if (!active) return;
        setClient(sb);
        const { data: listener } = sb.auth.onAuthStateChange((_event, next) => {
          revision++;
          accept(next);
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
  }, [queryClient]);

  const permissions = useQuery({
    queryKey: ["session-permissions", session?.user.id],
    enabled: !!client && !!session,
    staleTime: 0,
    refetchInterval: 60_000,
    retry: 1,
    queryFn: async () => {
      const [profile, roles] = await Promise.all([
        client!.from("profiles").select("ativo").eq("id", session!.user.id).single(),
        client!.from("user_roles").select("role").eq("user_id", session!.user.id),
      ]);
      if (profile.error || roles.error)
        throw new Error("Não foi possível verificar seu acesso. Tente novamente.");
      if (profile.data?.ativo !== true)
        throw new Error("Seu acesso está desativado. Procure o administrador.");
      return (roles.data ?? []).map((r: { role: AppRole }) => r.role);
    },
  });
  const roles = session && !permissions.isError ? (permissions.data ?? []) : [];
  const loading = initializing || (!!session && permissions.isPending);
  const error =
    connectionError ?? (session && permissions.error ? permissions.error.message : null);
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
