import { useQuery } from "@tanstack/react-query";

import { useSupabase } from "@/lib/supabase-provider";

export type PermissaoFin =
  | "financeiro_ver"
  | "pagar_criar"
  | "pagar_editar"
  | "pagar_aprovar"
  | "receber_criar"
  | "receber_baixar"
  | "dre_ver"
  | "custos_ver"
  | "margens_ver"
  | "bancos_ver"
  | "transferir"
  | "categorias_gerenciar"
  | "centros_gerenciar";

/**
 * Permissões financeiras granulares do usuário logado (tabela role_permissoes).
 * Admin e gestor recebem tudo pelo próprio RPC do banco.
 */
export function usePermissoesFin() {
  const { client, roles, loading, user } = useSupabase();
  const total = roles.includes("admin") || roles.includes("gestor");

  const q = useQuery({
    queryKey: ["minhas_permissoes", user?.id, roles.slice().sort().join(",")],
    enabled: !!client && !loading,
    queryFn: async () => {
      const { data, error } = await client!.rpc("minhas_permissoes");
      if (error) throw new Error("Não foi possível verificar as permissões financeiras.");
      return (data ?? []) as string[];
    },
  });

  const lista = new Set<string>(q.isError ? [] : (q.data ?? []));

  return {
    carregando: loading || q.isLoading,
    total,
    lista,
    pode: (p: PermissaoFin) => total || lista.has(p),
  };
}
