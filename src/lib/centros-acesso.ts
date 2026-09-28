import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { getCentro, setCentro, useCentro } from "@/lib/centro-store";
import { useSupabase } from "@/lib/supabase-provider";

export type CentroOpcao = { id: string; nome: string };

/**
 * Centros que o usuario logado pode acessar.
 * `todos` = true quando ele tem acesso a todos os centros cadastrados.
 */
export function useCentrosPermitidos() {
  const { client, user, loading } = useSupabase();

  const centros = useQuery({
    queryKey: ["centros", "permitidos", user?.id],
    enabled: !!client && !!user && !loading,
    queryFn: async () => {
      const todos = await client!.from("centros").select("id, nome").order("nome");
      if (todos.error) throw new Error(todos.error.message);
      const permitidos = await client!.rpc("meus_centros");
      if (permitidos.error) throw new Error(permitidos.error.message);
      const ids = ((permitidos.data ?? []) as unknown[]).map((v) =>
        typeof v === "string" ? v : String((v as { meus_centros?: string })?.meus_centros ?? ""),
      );
      const lista = ((todos.data ?? []) as CentroOpcao[]).filter((c) => ids.includes(c.id));
      return {
        lista,
        todos: lista.length === (todos.data ?? []).length,
      };
    },
  });

  return {
    lista: centros.data?.lista ?? [],
    todos: centros.data?.todos ?? false,
    isLoading: centros.isLoading,
    error: centros.error,
  };
}

/**
 * Garante que o centro selecionado esteja entre os permitidos.
 * Usuarios restritos ficam sempre travados em um centro.
 */
export function useCentroValido() {
  const { lista, todos, isLoading, error } = useCentrosPermitidos();
  const { centro } = useCentro();

  useEffect(() => {
    if (isLoading || todos) return;
    if (!lista.length) return;
    const atual = getCentro();
    if (!atual || !lista.some((c) => c.id === atual)) {
      setCentro(lista[0]!.id);
    }
  }, [isLoading, todos, lista]);

  return {
    centro: todos || lista.some((c) => c.id === centro) ? centro : (lista[0]?.id ?? ""),
    lista,
    todos,
    isLoading,
    error,
  };
}
