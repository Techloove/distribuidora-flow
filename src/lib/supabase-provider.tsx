import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { getSupabaseClient } from "./supabase-client";

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
          setSession(newSession ?? null);
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
      return;
    }
    let active = true;
    client
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .then(({ data }) => {
        if (!active) return;
        setRoles(((data ?? []) as { role: AppRole }[]).map((r) => r.role));
      });
    return () => {
      active = false;
    };
  }, [client, userId]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await client?.auth.signOut();
  }

  const value: SupabaseContextValue = {
    client,
    session,
    user: session?.user ?? null,
    roles,
    loading,
    error,
    canManage: roles.includes("admin") || roles.includes("gestor"),
    signOut,
  };

  return <SupabaseContext.Provider value={value}>{children}</SupabaseContext.Provider>;
}

export function useSupabase() {
  const ctx = useContext(SupabaseContext);
  if (!ctx) throw new Error("useSupabase precisa estar dentro de <SupabaseProvider>");
  return ctx;
}
