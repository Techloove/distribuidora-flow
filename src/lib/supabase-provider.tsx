import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { getSupabaseClient } from "./supabase-client";
import { setCentro } from "./centro-store";

export type AppRole =
  | "admin"
  | "gestor"
  | "financeiro"
  | "comercial"
  | "representante"
  | "estoque"
  | "expedicao";

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
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let active = true;

    getSupabaseClient()
      .then(async (sb) => {
        if (!active) return;
        setClient(sb);

        const { data } = await sb.auth.getSession();
        if (!active) return;
        setSession(data.session ?? null);
        setLoading(false);

        const { data: sub } = sb.auth.onAuthStateChange((event, newSession) => {
          setSession((previous) => {
            const previousId = previous?.user?.id ?? null;
            const nextId = newSession?.user?.id ?? null;
            if (previousId !== nextId) {
              void queryClient.cancelQueries();
              queryClient.clear();
              setCentro("");
            }
            return newSession ?? null;
          });
          if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
          router.invalidate();
          if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
        });
        unsub = () => sub.subscription.unsubscribe();
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Falha ao conectar no Supabase");
        setLoading(false);
      });

    return () => {
      active = false;
      unsub?.();
    };
  }, [router, queryClient]);

  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!client || !userId) {
      setRoles([]);
      setAccessError(null);
      setPermissionsLoading(false);
      return;
    }
    let active = true;
    setPermissionsLoading(true);
    setAccessError(null);
    Promise.all([
      client.from("profiles").select("ativo").eq("id", userId).single(),
      client.from("user_roles").select("role").eq("user_id", userId),
    ]).then(([profile, roleRows]) => {
      if (!active) return;
      if (profile.error || roleRows.error) {
        setRoles([]);
        setAccessError("Não foi possível verificar seu acesso. Tente novamente.");
        setPermissionsLoading(false);
        return;
      }
      if (profile.data?.ativo !== true) {
        setRoles([]);
        setAccessError("Seu acesso está desativado ou aguarda liberação.");
        setPermissionsLoading(false);
        return;
      }
      const nextRoles = ((roleRows.data ?? []) as { role: AppRole }[]).map((row) => row.role);
      if (nextRoles.length === 0) {
        setRoles([]);
        setAccessError("Usuário sem papel de acesso atribuído.");
      } else {
        setRoles(nextRoles);
      }
      setPermissionsLoading(false);
    }).catch(() => {
      if (!active) return;
      setRoles([]);
      setAccessError("Não foi possível verificar seu acesso. Tente novamente.");
      setPermissionsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [client, userId]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await client?.auth.signOut();
    setCentro("");
  }

  const value: SupabaseContextValue = {
    client,
    session,
    user: session?.user ?? null,
    roles,
    loading: loading || permissionsLoading,
    error: error ?? accessError,
    canManage:
      !(loading || permissionsLoading) &&
      !(error ?? accessError) &&
      (roles.includes("admin") || roles.includes("gestor")),
    signOut,
  };

  return <SupabaseContext.Provider value={value}>{children}</SupabaseContext.Provider>;
}

export function useSupabase() {
  const ctx = useContext(SupabaseContext);
  if (!ctx) throw new Error("useSupabase precisa estar dentro de <SupabaseProvider>");
  return ctx;
}
