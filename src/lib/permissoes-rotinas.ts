import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/lib/supabase-provider";
import { useAcesso } from "@/lib/permissoes";

export const ACOES_ROTINAS = {
  margem_pedido_ver: "/pedidos",
  frete_pedido_editar: "/pedidos",
  reposicao_ver: "/planejamento-compras",
  comercial_acompanhar: "/agenda-comercial",
  cobranca_acompanhar: "/cobranca",
  entrega_registrar: "/expedicao",
  carga_capacidade_editar: "/cargas",
  devolucao_operar: "/devolucoes",
  troca_vincular: "/devolucoes",
  comissao_ajustes_ver: "/comissoes",
  comissao_ajustes_conferir: "/comissoes",
  extrato_ver: "/movimentacoes",
  extrato_importar: "/movimentacoes",
  extrato_conciliar: "/movimentacoes",
  extrato_desconciliar: "/movimentacoes",
  configuracao_rotinas_editar: "/configuracoes",
} as const;
export type AcaoRotina = keyof typeof ACOES_ROTINAS;

/** Ação e menu são necessários; o servidor continua conferindo papel, centro e carteira. */
export function usePermissoesRotinas() {
  const { client, user, roles, loading, error } = useSupabase();
  const acesso = useAcesso();
  const q = useQuery({
    queryKey: ["minhas_permissoes", user?.id, roles.slice().sort().join(",")],
    enabled: !!client && !!user && !loading && !error,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await client!.rpc("minhas_permissoes");
      if (error) throw new Error("Não foi possível verificar as permissões das rotinas.");
      return (data ?? []) as string[];
    },
  });
  const carregando = loading || acesso.carregando || q.isPending;
  const total = roles.includes("admin") || roles.includes("gestor");
  return {
    carregando,
    erro: q.error,
    pode: (acao: AcaoRotina) =>
      !error &&
      !loading &&
      !acesso.erro &&
      !q.isError &&
      acesso.pode(ACOES_ROTINAS[acao]) &&
      (total || (!carregando && (q.data ?? []).includes(acao))),
  };
}
