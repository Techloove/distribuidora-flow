import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/lib/supabase-provider";
import { useAcesso } from "@/lib/permissoes";

export const ACOES_ROTINAS = {
  integridade_ver: "/configuracoes",
  receber_renegociar: "/receber",
  comissao_proporcional_operar: "/comissoes",
  compra_xml_importar: "/compras",
  pix_gerar: "/receber",
  indicadores_comparar: "/relatorios",
  deposito_operar: "/estoque",
  inventario_contar: "/estoque",
  inventario_conferir: "/estoque",
  entrega_parcial_operar: "/expedicao",
  rentabilidade_editar: "/pedidos",
  margem_pedido_ver: "/pedidos",
  frete_pedido_editar: "/pedidos",
  reposicao_ver: "/planejamento-compras",
  comercial_acompanhar: "/agenda-comercial",
  cobranca_acompanhar: "/agenda-comercial",
  clientes_reativar: "/agenda-comercial",
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

const CAPACIDADES: Partial<Record<AcaoRotina, readonly string[]>> = {
  deposito_operar: ["estoque"],
  inventario_contar: ["estoque"],
  inventario_conferir: ["estoque"],
  entrega_parcial_operar: ["expedicao", "estoque"],
  receber_renegociar: ["financeiro"],
  pix_gerar: ["financeiro"],
  comissao_proporcional_operar: ["financeiro"],
  compra_xml_importar: ["estoque", "expedicao", "financeiro"],
  indicadores_comparar: [],
  integridade_ver: [],
  rentabilidade_editar: [],
};

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
      (total || !CAPACIDADES[acao] || roles.some((role) => CAPACIDADES[acao]!.includes(role))) &&
      (total || (!carregando && (q.data ?? []).includes(acao))),
  };
}
